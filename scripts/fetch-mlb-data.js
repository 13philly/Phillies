// scripts/fetch-mlb-data.js
const fs=require("fs");
const https=require("https");

const TEAM=143;
const SEASON=new Date().getUTCFullYear();
const OUT="data/fetch-mlb-data.json";
const BASE="https://statsapi.mlb.com/api/v1";

const get=url=>new Promise((resolve,reject)=>{
  https.get(url,r=>{
    let s="";
    r.on("data",d=>s+=d);
    r.on("end",()=>{
      try{resolve(JSON.parse(s))}
      catch(e){reject(e)}
    });
  }).on("error",reject);
});

const api=(path,params={})=>{
  const u=new URL(BASE+path);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  return get(u);
};

const teamSide=(game,side)=>{
  const t=game.teams[side];
  return {
    id:t.team.id,
    name:t.team.name,
    abbreviation:t.team.abbreviation,
    score:t.score??null,
    hits:t.hits??null,
    errors:t.errors??null,
    winner:t.isWinner??false
  };
};

const players=team=>{
  return Object.values(team?.players||{}).map(p=>({
    id:p.person?.id??null,
    name:p.person?.fullName??null,
    position:p.position?.abbreviation??null,
    jersey:p.jerseyNumber??null,
    batting:p.stats?.batting??null,
    pitching:p.stats?.pitching??null
  })).filter(p=>p.batting||p.pitching);
};

async function boxscore(gamePk){
  const b=await api(`/game/${gamePk}/boxscore`);
  const out={};

  for(const side of ["away","home"]){
    const t=b.teams?.[side];
    if(!t)continue;

    out[side]={
      team:t.team,
      batting:players(t).filter(p=>p.batting),
      pitching:players(t).filter(p=>p.pitching),
      totals:t.teamStats||{}
    };
  }

  return out;
}

async function feed(gamePk){
  const f=await get(
    `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`
  );

  const l=f.liveData?.linescore||{};
  const innings=(l.innings||[]).map(i=>({
    inning:i.num,
    away:{
      R:i.away?.runs??0,
      H:i.away?.hits??0,
      E:i.away?.errors??0
    },
    home:{
      R:i.home?.runs??0,
      H:i.home?.hits??0,
      E:i.home?.errors??0
    }
  }));

  return {
    status:f.gameData?.status||null,
    linescore:{
      inning:l.currentInning??null,
      ordinal:l.currentInningOrdinal??null,
      state:l.inningState??null,
      balls:l.balls??null,
      strikes:l.strikes??null,
      outs:l.outs??null,
      innings
    }
  };
}

async function main(){
  const schedule=await api("/schedule",{
    sportId:1,
    teamId:TEAM,
    season:SEASON,
    hydrate:"team,venue,linescore"
  });

  const games=schedule.dates?.flatMap(d=>d.games||[])||[];
  const result=[];

  for(const game of games){
    const away=teamSide(game,"away");
    const home=teamSide(game,"home");
    const philliesHome=home.id===TEAM;
    const phillies=philliesHome?home:away;
    const opponent=philliesHome?away:home;

    let boxscore=null;
    let live=null;

    try{boxscore=await boxscore(game.gamePk)}
    catch{}

    try{live=await feed(game.gamePk)}
    catch{}

    result.push({
      gamePk:game.gamePk,
      date:game.gameDate,
      season:SEASON,

      status:{
        abstract:game.status?.abstractGameState??null,
        detailed:game.status?.detailedState??null,
        code:game.status?.codedGameState??null
      },

      venue:{
        id:game.venue?.id??null,
        name:game.venue?.name??null
      },

      phillies:{
        home:philliesHome,
        team:phillies,
        batting:boxscore?
          (philliesHome?boxscore.home?.batting:boxscore.away?.batting):[],
        pitching:boxscore?
          (philliesHome?boxscore.home?.pitching:boxscore.away?.pitching):[]
      },

      opponent,

      score:{
        R:phillies.score,
        H:phillies.hits,
        E:phillies.errors,
        opponentR:opponent.score,
        opponentH:opponent.hits,
        opponentE:opponent.errors
      },

      teams:{away,home},
      boxscore,
      live
    });
  }

  fs.mkdirSync("data",{recursive:true});

  fs.writeFileSync(
    OUT,
    JSON.stringify({
      season:SEASON,
      team:{
        id:TEAM,
        name:"Philadelphia Phillies"
      },
      updatedAt:new Date().toISOString(),
      games:result
    },null,2)
  );

  console.log(`Updated ${result.length} games for ${SEASON}`);
}

main().catch(e=>{
  console.error(e);
  process.exit(1);
});

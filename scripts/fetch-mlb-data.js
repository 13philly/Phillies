const fs=require("fs");
const path=require("path");

const TEAM=143;
const SEASON=new Date().getUTCFullYear();
const API="https://statsapi.mlb.com/api/v1";
const OUT=path.join("data","fetch-mlb-data.json");

async function get(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function api(path,params={}){
  const u=new URL(API+path);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  return get(u);
}

const team=x=>({
  id:x?.team?.id??null,
  name:x?.team?.name??null,
  abbreviation:x?.team?.abbreviation??null,
  R:x?.score??null,
  H:x?.hits??null,
  E:x?.errors??null,
  win:x?.isWinner??false
});

function batting(p){
  const s=p.stats?.batting;
  if(!s)return null;
  return {
    id:p.person?.id??null,
    name:p.person?.fullName??null,
    jersey:p.jerseyNumber??null,
    pos:p.position?.abbreviation??null,
    AB:s.atBats??0,
    R:s.runs??0,
    H:s.hits??0,
    RBI:s.rbi??0,
    BB:s.baseOnBalls??0,
    HR:s.homeRuns??0,
    SO:s.strikeOuts??0,
    AVG:s.avg??null,
    OBP:s.obp??null,
    SLG:s.slg??null,
    OPS:s.ops??null,
    BABIP:s.babip??null
  };
}

function pitching(p){
  const s=p.stats?.pitching;
  if(!s)return null;
  return {
    id:p.person?.id??null,
    name:p.person?.fullName??null,
    jersey:p.jerseyNumber??null,
    pos:p.position?.abbreviation??null,
    IP:s.inningsPitched??null,
    H:s.hits??0,
    R:s.runs??0,
    ER:s.earnedRuns??0,
    BB:s.baseOnBalls??0,
    SO:s.strikeOuts??0,
    HR:s.homeRuns??0,
    ERA:s.era??null,
    WHIP:s.whip??null,
    P:s.numberOfPitches??null
  };
}

async function players(gamePk,home){
  const d=await api(`/game/${gamePk}/boxscore`);
  const t=d.teams?.[home?"home":"away"];

  const batting=[];
  const pitching=[];

  for(const p of Object.values(t?.players||{})){
    const b=battingData(p);
    const q=pitchingData(p);
    if(b)batting.push(b);
    if(q)pitching.push(q);
  }

  return {batting,pitching};
}

const battingData=batting;
const pitchingData=pitching;

async function innings(gamePk){
  const d=await get(
    `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`
  );

  const l=d.liveData?.linescore;
  if(!l)return null;

  return {
    inning:l.currentInning??null,
    ordinal:l.currentInningOrdinal??null,
    state:l.inningState??null,
    balls:l.balls??null,
    strikes:l.strikes??null,
    outs:l.outs??null,
    data:(l.innings||[]).map(i=>({
      n:i.num,
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
    }))
  };
}

async function main(){
  const schedule=await api("/schedule",{
    sportId:1,
    teamId:TEAM,
    season:SEASON,
    hydrate:"team,venue,linescore"
  });

  const games=schedule.dates?.flatMap(x=>x.games||[])||[];
  const output=[];

  for(const g of games){
    const away=team(g.teams?.away);
    const home=team(g.teams?.home);
    const homeGame=home.id===TEAM;
    const phillies=homeGame?home:away;
    const opponent=homeGame?away:home;

    let data={batting:[],pitching:[]};
    let line=null;

    if(["Final","Live"].includes(g.status?.abstractGameState)){
      try{
        data=await players(g.gamePk,homeGame);
      }catch(e){
        console.error(`BOX ${g.gamePk}: ${e.message}`);
      }

      try{
        line=await innings(g.gamePk);
      }catch(e){
        console.error(`LIVE ${g.gamePk}: ${e.message}`);
      }
    }

    output.push({
      gamePk:g.gamePk,
      date:g.gameDate,
      type:g.gameType??null,

      status:{
        abstract:g.status?.abstractGameState??null,
        detailed:g.status?.detailedState??null
      },

      venue:{
        id:g.venue?.id??null,
        name:g.venue?.name??null
      },

      opponent:{
        id:opponent.id,
        name:opponent.name,
        abbreviation:opponent.abbreviation
      },

      home:homeGame,

      score:{
        R:phillies.R,
        H:phillies.H,
        E:phillies.E,
        opponentR:opponent.R,
        opponentH:opponent.H,
        opponentE:opponent.E
      },

      innings:line,

      batting:data.batting,

      pitching:data.pitching
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
      games:output
    },null,2),
    "utf8"
  );

  console.log(`Saved ${output.length} games to ${OUT}`);
}

main().catch(e=>{
  console.error(e);
  process.exit(1);
});

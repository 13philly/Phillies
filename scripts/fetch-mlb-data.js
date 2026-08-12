const fs=require("fs");
const path=require("path");

const TEAM_ID=143;
const SEASON=new Date().getUTCFullYear();
const API="https://statsapi.mlb.com/api/v1";
const FILE=path.join(process.cwd(),"data","fetch-mlb-data.json");

async function get(url){
  const res=await fetch(url);
  if(!res.ok)throw new Error(`${res.status} ${url}`);
  return res.json();
}

function api(path,params={}){
  const url=new URL(API+path);
  for(const [key,value] of Object.entries(params)){
    url.searchParams.set(key,value);
  }
  return get(url);
}

function team(data){
  return {
    id:data?.team?.id??null,
    name:data?.team?.name??null,
    abbreviation:data?.team?.abbreviation??null,
    score:data?.score??null,
    hits:data?.hits??null,
    errors:data?.errors??null,
    winner:data?.isWinner??false
  };
}

function player(data,stats){
  return {
    id:data.person?.id??null,
    name:data.person?.fullName??null,
    jersey:data.jerseyNumber??null,
    position:data.position?.abbreviation??null,
    stats:stats||{}
  };
}

async function getBoxscore(gamePk){
  const data=await get(
    `${API}/game/${gamePk}/boxscore`
  );

  const result={};

  for(const side of ["away","home"]){
    const teamData=data.teams?.[side];
    if(!teamData)continue;

    const batting=[];
    const pitching=[];

    for(const p of Object.values(teamData.players||{})){
      if(p.stats?.batting){
        batting.push(player(p,p.stats.batting));
      }

      if(p.stats?.pitching){
        pitching.push(player(p,p.stats.pitching));
      }
    }

    result[side]={
      team:teamData.team||null,
      batting,
      pitching,
      teamStats:teamData.teamStats||{}
    };
  }

  return result;
}

async function getLive(gamePk){
  const data=await get(
    `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`
  );

  const linescore=data.liveData?.linescore||{};

  return {
    inning:linescore.currentInning??null,
    ordinal:linescore.currentInningOrdinal??null,
    state:linescore.inningState??null,
    balls:linescore.balls??null,
    strikes:linescore.strikes??null,
    outs:linescore.outs??null,
    innings:(linescore.innings||[]).map(i=>({
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
    }))
  };
}

async function main(){
  const schedule=await api("/schedule",{
    sportId:1,
    teamId:TEAM_ID,
    season:SEASON,
    hydrate:"team,venue,linescore"
  });

  const games=schedule.dates?.flatMap(
    date=>date.games||[]
  )||[];

  const output=[];

  for(const game of games){
    const away=team(game.teams?.away);
    const home=team(game.teams?.home);

    const philliesHome=home.id===TEAM_ID;
    const phillies=philliesHome?home:away;
    const opponent=philliesHome?away:home;

    let boxscore=null;
    let live=null;

    try{
      boxscore=await getBoxscore(game.gamePk);
    }catch(error){
      console.error(`Boxscore ${game.gamePk}:`,error.message);
    }

    if(
      game.status?.abstractGameState==="Live"||
      game.status?.abstractGameState==="Final"
    ){
      try{
        live=await getLive(game.gamePk);
      }catch(error){
        console.error(`Live ${game.gamePk}:`,error.message);
      }
    }

    const own=boxscore
      ?philliesHome?boxscore.home:boxscore.away
      :null;

    output.push({
      gamePk:game.gamePk,
      season:SEASON,
      date:game.gameDate,
      gameType:game.gameType??null,

      status:{
        abstract:game.status?.abstractGameState??null,
        detailed:game.status?.detailedState??null,
        code:game.status?.codedGameState??null
      },

      venue:{
        id:game.venue?.id??null,
        name:game.venue?.name??null
      },

      opponent:{
        id:opponent.id,
        name:opponent.name,
        abbreviation:opponent.abbreviation
      },

      home:philliesHome,

      score:{
        R:phillies.score,
        H:phillies.hits,
        E:phillies.errors,
        opponentR:opponent.score,
        opponentH:opponent.hits,
        opponentE:opponent.errors
      },

      teams:{
        away,
        home
      },

      innings:live?.innings||[],

      batting:own?.batting||[],

      pitching:own?.pitching||[],

      teamStats:own?.teamStats||{},

      boxscore,

      live
    });
  }

  const result={
    season:SEASON,

    team:{
      id:TEAM_ID,
      name:"Philadelphia Phillies"
    },

    updatedAt:new Date().toISOString(),

    games:output
  };

  fs.mkdirSync(
    path.dirname(FILE),
    {recursive:true}
  );

  fs.writeFileSync(
    FILE,
    JSON.stringify(result,null,2),
    "utf8"
  );

  console.log(
    `Wrote ${output.length} games to ${FILE}`
  );
}

main().catch(error=>{
  console.error(error);
  process.exit(1);
});

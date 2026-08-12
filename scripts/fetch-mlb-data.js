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

async function api(url,params={}){
  const u=new URL(API+url);
  for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);
  return get(u);
}

function side(t){
  return{
    R:t?.score??null,
    H:t?.hits??null,
    E:t?.errors??null
  };
}

async function getGame(g){
  const home=g.teams.home.team.id===TEAM;
  const ph=home?g.teams.home:g.teams.away;
  const opp=home?g.teams.away:g.teams.home;

  const game={
    gamePk:g.gamePk,
    date:g.gameDate,
    status:g.status?.detailedState??null,
    venue:g.venue?.name??null,
    opponent:opp.team?.name??null,
    home,
    boxscore:null,
    batting:[],
    pitching:[]
  };

  if(g.status?.abstractGameState==="Preview")return game;

  const box=await api(`/game/${g.gamePk}/boxscore`);
  const t=box.teams?.[home?"home":"away"];
  const l=box.linescore;

  game.boxscore={
    innings:(l?.innings||[]).map(i=>({
      inning:i.num,
      PHI:home?side(i.home):side(i.away),
      OPP:home?side(i.away):side(i.home)
    })),
    PHI:side(ph),
    OPP:side(opp)
  };

  for(const p of Object.values(t?.players||{})){
    const b=p.stats?.batting;
    const pi=p.stats?.pitching;

    if(b){
      game.batting.push({
        order:p.battingOrder
          ?Number(String(p.battingOrder).slice(0,1))
          :null,
        id:p.person?.id??null,
        name:p.person?.fullName??null,
        AB:b.atBats??0,
        R:b.runs??0,
        H:b.hits??0,
        RBI:b.rbi??0,
        BB:b.baseOnBalls??0
      });
    }

    if(pi){
      game.pitching.push({
        id:p.person?.id??null,
        name:p.person?.fullName??null,
        IP:pi.inningsPitched??null,
        H:pi.hits??0,
        ER:pi.earnedRuns??0,
        BB:pi.baseOnBalls??0,
        SO:pi.strikeOuts??0
      });
    }
  }

  game.batting.sort((a,b)=>(a.order??99)-(b.order??99));

  return game;
}

async function main(){
  const schedule=await api("/schedule",{
    sportId:1,
    teamId:TEAM,
    season:SEASON,
    startDate:`${SEASON}-01-01`,
    endDate:`${SEASON}-12-31`,
    hydrate:"team,venue"
  });

  const games=schedule.dates?.flatMap(d=>d.games||[])||[];
  const data=[];

  for(const g of games){
    try{
      data.push(await getGame(g));
    }catch(e){
      console.error(`${g.gamePk}: ${e.message}`);
    }
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
      games:data
    })
  );

  console.log(`${SEASON}: ${data.length} games saved`);
}

main().catch(e=>{
  console.error(e);
  process.exit(1);
});

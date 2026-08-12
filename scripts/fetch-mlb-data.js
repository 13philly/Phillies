const fs=require("fs");
const path=require("path");

const TEAM=143;
const SEASON=Number(process.env.SEASON)||new Date().getUTCFullYear();
const API="https://statsapi.mlb.com/api/v1";
const OUT=path.join("data","fetch-mlb-data.json");

async function get(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function api(url,params={}){
  const u=new URL(API+url);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  return get(u);
}

function team(t){
  return{
    name:t.team?.name??null,
    R:t.score??null,
    H:t.hits??null,
    E:t.errors??null
  };
}

async function game(g){
  const home=g.teams.home.team.id===TEAM;
  const ph=home?g.teams.home:g.teams.away;
  const opp=home?g.teams.away:g.teams.home;

  const result={
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

  if(g.status?.abstractGameState==="Preview")return result;

  const box=await api(`/game/${g.gamePk}/boxscore`);
  const teamData=box.teams?.[home?"home":"away"];
  const lines=box.linescore;

  result.boxscore={
    innings:(lines?.innings||[]).map(i=>({
      inning:i.num,
      PHI:team({
        team:{name:"PHI"},
        score:home?i.home?.runs:i.away?.runs,
        hits:home?i.home?.hits:i.away?.hits,
        errors:home?i.home?.errors:i.away?.errors
      }),
      OPP:team({
        team:{name:"OPP"},
        score:home?i.away?.runs:i.home?.runs,
        hits:home?i.away?.hits:i.home?.hits,
        errors:home?i.away?.errors:i.home?.errors
      })
    })),
    PHI:team(ph),
    OPP:team(opp)
  };

  for(const p of Object.values(teamData?.players||{})){
    const b=p.stats?.batting;
    const pi=p.stats?.pitching;

    if(b){
      result.batting.push({
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
      result.pitching.push({
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

  result.batting.sort((a,b)=>
    (a.order??99)-(b.order??99)
  );

  return result;
}

async function main(){
  const schedule=await api("/schedule",{
    sportId:1,
    teamId:TEAM,
    season:SEASON,
    hydrate:"team,venue",
    startDate:`${SEASON}-01-01`,
    endDate:`${SEASON}-12-31`
  });

  const games=schedule.dates?.flatMap(d=>d.games||[])||[];
  const output=[];

  for(const g of games){
    try{
      output.push(await game(g));
      console.log(`${g.gamePk} ${g.status.detailedState}`);
    }catch(e){
      console.error(`ERROR ${g.gamePk}: ${e.message}`);
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
      games:output
    })
  );

  console.log(
    `Saved ${output.length} games for ${SEASON}`
  );
}

main().catch(e=>{
  console.error(e);
  process.exit(1);
});

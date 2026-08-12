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

function stats(p,type){
  return p.stats?.[type];
}

async function getGame(g){
  const home=g.teams.home.team.id===TEAM;
  const ph=home?g.teams.home:g.teams.away;
  const opp=home?g.teams.away:g.teams.home;

  let box=null;

  if(g.status.abstractGameState!=="Preview"){
    box=await api(`/game/${g.gamePk}/boxscore`);
  }

  const team=box?.teams?.[home?"home":"away"];

  const bat=(team?.players
    ?Object.values(team.players)
    :[]
  ).map((p,i)=>{
    const s=stats(p,"batting");
    if(!s)return null;

    return{
      order:p.battingOrder
        ?Number(String(p.battingOrder).slice(0,1))
        :null,
      id:p.person?.id??null,
      name:p.person?.fullName??null,
      AB:s.atBats??0,
      R:s.runs??0,
      H:s.hits??0,
      RBI:s.rbi??0,
      BB:s.baseOnBalls??0
    };
  }).filter(Boolean)
    .sort((a,b)=>(a.order??99)-(b.order??99));

  const pitching=(team?.players
    ?Object.values(team.players)
    :[]
  ).map(p=>{
    const s=stats(p,"pitching");
    if(!s)return null;

    return{
      id:p.person?.id??null,
      name:p.person?.fullName??null,
      IP:s.inningsPitched??null,
      H:s.hits??0,
      ER:s.earnedRuns??0,
      BB:s.baseOnBalls??0,
      SO:s.strikeOuts??0
    };
  }).filter(Boolean);

  const linescore=box?.linescore;

  return{
    gamePk:g.gamePk,
    date:g.gameDate,
    venue:g.venue?.name??null,
    opponent:opp.team?.name??null,

    boxscore:{
      innings:(linescore?.innings||[]).map(i=>({
        inning:i.num,
        PHI:{
          R:home?i.home?.runs??0:i.away?.runs??0,
          H:home?i.home?.hits??0:i.away?.hits??0,
          E:home?i.home?.errors??0:i.away?.errors??0
        },
        OPP:{
          R:home?i.away?.runs??0:i.home?.runs??0,
          H:home?i.away?.hits??0:i.home?.hits??0,
          E:home?i.away?.errors??0:i.home?.errors??0
        }
      })),
      PHI:{
        R:ph.runs??null,
        H:ph.hits??null,
        E:ph.errors??null
      },
      OPP:{
        R:opp.runs??null,
        H:opp.hits??null,
        E:opp.errors??null
      }
    },

    batting:bat,
    pitching
  };
}

async function main(){
  const d=await api("/schedule",{
    sportId:1,
    teamId:TEAM,
    season:SEASON,
    hydrate:"team,venue"
  });

  const games=d.dates?.flatMap(x=>x.games||[])||[];
  const data=[];

  for(const g of games){
    try{
      data.push(await getGame(g));
      console.log(g.gamePk);
    }catch(e){
      console.error(g.gamePk,e.message);
    }
  }

  fs.mkdirSync("data",{recursive:true});

  fs.writeFileSync(
    OUT,
    JSON.stringify({
      season:SEASON,
      team:"Philadelphia Phillies",
      updatedAt:new Date().toISOString(),
      games:data
    })
  );

  console.log(`Saved ${data.length} games`);
}

main().catch(e=>{
  console.error(e);
  process.exit(1);
});

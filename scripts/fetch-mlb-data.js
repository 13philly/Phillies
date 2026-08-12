const fs=require("fs");
const path=require("path");

const TEAM_ID=143;
const SEASON=new Date().getUTCFullYear();
const API="https://statsapi.mlb.com/api/v1";
const OUT=path.join("data","fetch-mlb-data.json");

async function get(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function api(endpoint,params={}){
  const u=new URL(API+endpoint);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  return get(u);
}

function side(x){
  return {
    R:x?.runs??0,
    H:x?.hits??0,
    E:x?.errors??0
  };
}

function result(game,home){
  const phi=home?game.teams.home:game.teams.away;
  const opp=home?game.teams.away:game.teams.home;

  if(game.status?.abstractGameState!=="Final")return null;

  if(phi.score>opp.score)return"W";
  if(phi.score<opp.score)return"L";
  return"T";
}

async function getGame(game){
  const home=game.teams.home.team.id===TEAM_ID;
  const phi=home?game.teams.home:game.teams.away;
  const opp=home?game.teams.away:game.teams.home;

  const out={
    gamePk:game.gamePk,
    date:game.gameDate,
    status:game.status?.detailedState??null,
    venue:game.venue?.name??null,
    opponent:opp.team.name,
    home,
    result:result(game,home),
    score:{
      PHI:side(phi),
      OPP:side(opp)
    },
    innings:[],
    batting:[],
    pitching:[]
  };

  if(game.status?.abstractGameState==="Preview")return out;

  const [linescore,boxscore]=await Promise.all([
    api(`/game/${game.gamePk}/linescore`),
    api(`/game/${game.gamePk}/boxscore`)
  ]);

  out.innings=(linescore.innings||[]).map(i=>({
    inning:i.num,
    PHI:home?side(i.home):side(i.away),
    OPP:home?side(i.away):side(i.home)
  }));

  const team=boxscore.teams?.[home?"home":"away"];

  /*
   * 打撃データ
   */
  for(const p of Object.values(team?.players||{})){
    const batting=p.stats?.batting;

    if(batting){
      out.batting.push({
        order:p.battingOrder
          ?Number(String(p.battingOrder).slice(0,1))
          :null,
        name:p.person?.fullName??null,
        AB:batting.atBats??0,
        R:batting.runs??0,
        H:batting.hits??0,
        RBI:batting.rbi??0,
        BB:batting.baseOnBalls??0
      });
    }
  }

  /*
   * 投手データ
   *
   * team.pitchers はMLB Stats APIが返す
   * 実際の投手起用順の配列。
   *
   * その配列順をそのまま
   * 1=最初の投手
   * 2=2番目の投手
   * 3=3番目の投手
   * ...
   * として保存する。
   */
  const pitcherOrder=Array.isArray(team?.pitchers)
    ?team.pitchers
    :[];

  pitcherOrder.forEach((playerId,index)=>{
    const p=team?.players?.[playerId];
    if(!p)return;

    const pitching=p.stats?.pitching;
    if(!pitching)return;

    out.pitching.push({
      order:index+1,
      name:p.person?.fullName??null,
      IP:pitching.inningsPitched??null,
      H:pitching.hits??0,
      ER:pitching.earnedRuns??0,
      BB:pitching.baseOnBalls??0,
      SO:pitching.strikeOuts??0
    });
  });

  /*
   * 打順を1〜9番順にする
   */
  out.batting.sort(
    (a,b)=>(a.order??99)-(b.order??99)
  );

  /*
   * 念のため登板順でもソート
   */
  out.pitching.sort(
    (a,b)=>(a.order??99)-(b.order??99)
  );

  return out;
}

async function main(){
  const schedule=await api("/schedule",{
    sportId:1,
    teamId:TEAM_ID,
    season:SEASON,
    startDate:`${SEASON}-01-01`,
    endDate:`${SEASON}-12-31`,
    hydrate:"team,venue"
  });

  const games=schedule.dates?.flatMap(d=>d.games||[])||[];
  const data=[];

  for(const game of games){
    try{
      data.push(await getGame(game));
      console.log(game.gamePk);
    }catch(error){
      console.error(
        `gamePk ${game.gamePk}:`,
        error.message
      );
    }
  }

  fs.mkdirSync(
    path.dirname(OUT),
    {recursive:true}
  );

  fs.writeFileSync(
    OUT,
    JSON.stringify({
      season:SEASON,
      team:{
        id:TEAM_ID,
        name:"Philadelphia Phillies"
      },
      updatedAt:new Date().toISOString(),
      games:data
    })
  );

  console.log(`Saved ${data.length} games`);
}

main().catch(error=>{
  console.error(error);
  process.exit(1);
});

const fs = require("fs");

const API = "https://statsapi.mlb.com/api/v1";
const TEAM_ID = 143;

// 優先順位
const PRIORITY = {
  IL: 3,
  ACTIVE: 2,
  "40-MAN": 1
};

async function getJSON(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${url}`);
  }

  return res.json();
}

async function getRoster(type) {
  const url =
    `${API}/teams/${TEAM_ID}/roster` +
    `?rosterType=${encodeURIComponent(type)}`;

  const data = await getJSON(url);

  return data.roster || [];
}

function isIL(entry) {
  const status = entry.status || {};

  const code =
    String(status.code || "").toUpperCase();

  const description =
    String(status.description || "").toLowerCase();

  return (
    code.includes("IL") ||
    description.includes("injured list")
  );
}

function addRoster(map, roster, type) {
  for (const entry of roster) {
    const id = entry.person?.id;

    if (!id) continue;

    if (!map.has(id)) {
      map.set(id, {
        id,
        active: false,
        il: false,
        fortyMan: false,
        entry
      });
    }

    const player = map.get(id);

    if (type === "ACTIVE") {
      player.active = true;
      player.entry = entry;
    }

    if (type === "40-MAN") {
      player.fortyMan = true;

      if (!player.entry) {
        player.entry = entry;
      }
    }

    if (type === "IL") {
      player.il = true;
      player.entry = entry;
    }
  }
}

function determineStatus(player) {
  /*
   * 現在の所属だけを判定。
   *
   * 優先順位:
   * IL
   * ↓
   * ACTIVE
   * ↓
   * 40-MAN
   */

  if (player.il) {
    return "IL";
  }

  if (player.active) {
    return "ACTIVE";
  }

  if (player.fortyMan) {
    return "40-MAN";
  }

  return null;
}

async function getPerson(id) {
  const data =
    await getJSON(`${API}/people/${id}`);

  return data.people?.[0] || null;
}

function createPlayer(entry, person, status) {
  return {
    id: person.id,
    name: person.fullName || "",
    number: entry.jerseyNumber || "",
    position:
      entry.position?.abbreviation || "",
    positionName:
      entry.position?.name || "",

    status,

    bats:
      person.batSide?.code || "",

    throws:
      person.pitchHand?.code || "",

    birthDate:
      person.birthDate || "",

    height:
      person.height || "",

    weight:
      person.weight || ""
  };
}

function sortPlayers(players) {
  const order = {
    IL: 0,
    ACTIVE: 1,
    "40-MAN": 2
  };

  return players.sort((a, b) => {
    const status =
      order[a.status] - order[b.status];

    if (status !== 0) {
      return status;
    }

    const an = Number(a.number);
    const bn = Number(b.number);

    if (!Number.isNaN(an) &&
        !Number.isNaN(bn)) {
      return an - bn;
    }

    if (!Number.isNaN(an)) return -1;
    if (!Number.isNaN(bn)) return 1;

    return a.name.localeCompare(b.name);
  });
}

async function main() {
  console.log("Fetching current Phillies rosters...");

  /*
   * 現在の3ロスターを独立取得
   */
  const activeRoster =
    await getRoster("Active");

  const fortyManRoster =
    await getRoster("40Man");

  /*
   * IL判定用。
   * fullRosterの現在情報のみを見る。
   */
  const fullRoster =
    await getRoster("fullRoster");

  /*
   * 選手IDごとに現在の所属を統合
   */
  const rosterMap = new Map();

  addRoster(
    rosterMap,
    activeRoster,
    "ACTIVE"
  );

  addRoster(
    rosterMap,
    fortyManRoster,
    "40-MAN"
  );

  /*
   * fullRosterから現在ILの選手だけを追加
   */
  for (const entry of fullRoster) {
    if (!isIL(entry)) continue;

    const id = entry.person?.id;

    if (!id) continue;

    if (!rosterMap.has(id)) {
      rosterMap.set(id, {
        id,
        active: false,
        il: true,
        fortyMan: false,
        entry
      });
    } else {
      rosterMap.get(id).il = true;
      rosterMap.get(id).entry = entry;
    }
  }

  /*
   * 最終ステータスを決定
   */
  const selected = [];

  for (const player of rosterMap.values()) {
    const status =
      determineStatus(player);

    /*
     * IL / ACTIVE / 40-MAN
     * のどれでもない選手は保存しない
     */
    if (!status) continue;

    selected.push({
      player,
      status
    });
  }

  /*
   * 基本情報取得
   */
  const players = [];

  for (const item of selected) {
    const person =
      await getPerson(item.player.id);

    if (!person) {
      console.warn(
        `Person not found: ${item.player.id}`
      );
      continue;
    }

    players.push(
      createPlayer(
        item.player.entry,
        person,
        item.status
      )
    );
  }

  sortPlayers(players);

  const output = {
    team: {
      id: TEAM_ID,
      name: "Philadelphia Phillies",
      abbreviation: "PHI"
    },

    updatedAt:
      new Date().toISOString(),

    players
  };

  fs.mkdirSync("data", {
    recursive: true
  });

  fs.writeFileSync(
    "data/players.json",
    JSON.stringify(
      output,
      null,
      2
    ) + "\n",
    "utf8"
  );

  /*
   * 確認ログ
   */
  const counts = {
    IL: players.filter(
      p => p.status === "IL"
    ).length,

    ACTIVE: players.filter(
      p => p.status === "ACTIVE"
    ).length,

    "40-MAN": players.filter(
      p => p.status === "40-MAN"
    ).length
  };

  console.log("");
  console.log("================================");
  console.log("CURRENT PHILLIES ROSTER");
  console.log("================================");
  console.log(`IL      : ${counts.IL}`);
  console.log(`ACTIVE  : ${counts.ACTIVE}`);
  console.log(`40-MAN  : ${counts["40-MAN"]}`);
  console.log(`TOTAL   : ${players.length}`);
  console.log("================================");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

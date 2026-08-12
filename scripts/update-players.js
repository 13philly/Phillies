const fs = require("fs");

const API = "https://statsapi.mlb.com/api/v1";
const TEAM_ID = 143;

async function getJSON(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`MLB API ${response.status}: ${url}`);
  }

  return response.json();
}

async function getRoster(rosterType) {
  const data = await getJSON(
    `${API}/teams/${TEAM_ID}/roster?rosterType=${rosterType}`
  );

  return data.roster || [];
}

async function getPerson(id) {
  const data = await getJSON(
    `${API}/people/${id}`
  );

  return data.people?.[0] || null;
}

function playerData(entry, person, status) {
  return {
    id: person.id,
    name: person.fullName || "",
    number: entry.jerseyNumber || "",
    position: entry.position?.abbreviation || "",
    positionName: entry.position?.name || "",
    status,
    bats: person.batSide?.code || "",
    throws: person.pitchHand?.code || "",
    birthDate: person.birthDate || "",
    height: person.height || "",
    weight: person.weight || ""
  };
}

async function main() {
  /*
   * 3種類を個別取得
   */
  const activeRoster = await getRoster("Active");
  const fortyManRoster = await getRoster("40Man");

  /*
   * fullRosterにはIL等のロスター情報も含まれる。
   * ここからIL対象を抽出する。
   */
  const fullRoster = await getRoster("fullRoster");

  const players = new Map();

  /*
   * ACTIVE
   */
  for (const entry of activeRoster) {
    const person = await getPerson(entry.person.id);

    if (!person) continue;

    players.set(person.id, {
      entry,
      person,
      status: "ACTIVE"
    });
  }

  /*
   * 40-MAN
   *
   * Activeに既に存在する選手はACTIVEを優先。
   */
  for (const entry of fortyManRoster) {
    const id = entry.person.id;

    if (players.has(id)) continue;

    const person = await getPerson(id);

    if (!person) continue;

    players.set(id, {
      entry,
      person,
      status: "40-MAN"
    });
  }

  /*
   * IL
   *
   * fullRosterのstatusを確認。
   */
  for (const entry of fullRoster) {
    const id = entry.person.id;

    const status = String(
      entry.status?.description || ""
    ).toLowerCase();

    const code = String(
      entry.status?.code || ""
    ).toUpperCase();

    const isIL =
      code.includes("IL") ||
      status.includes("injured list");

    if (!isIL) continue;

    const person = await getPerson(id);

    if (!person) continue;

    /*
     * ILはACTIVEより優先しない。
     * API上でActiveと重複する場合はActiveを維持。
     */
    if (players.has(id)) continue;

    players.set(id, {
      entry,
      person,
      status: "IL"
    });
  }

  /*
   * JSON化
   */
  const result = Array.from(players.values()).map(
    ({ entry, person, status }) =>
      playerData(entry, person, status)
  );

  /*
   * 並び順
   */
  const statusOrder = {
    ACTIVE: 0,
    IL: 1,
    "40-MAN": 2
  };

  result.sort((a, b) => {
    const statusDiff =
      statusOrder[a.status] -
      statusOrder[b.status];

    if (statusDiff !== 0) {
      return statusDiff;
    }

    const aNum = Number(a.number);
    const bNum = Number(b.number);

    if (Number.isNaN(aNum) && Number.isNaN(bNum)) {
      return a.name.localeCompare(b.name);
    }

    if (Number.isNaN(aNum)) return 1;
    if (Number.isNaN(bNum)) return -1;

    return aNum - bNum;
  });

  const output = {
    team: {
      id: TEAM_ID,
      name: "Philadelphia Phillies",
      abbreviation: "PHI"
    },
    updatedAt: new Date().toISOString(),
    players: result
  };

  fs.mkdirSync("data", {
    recursive: true
  });

  fs.writeFileSync(
    "data/players.json",
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  const active = result.filter(
    p => p.status === "ACTIVE"
  ).length;

  const il = result.filter(
    p => p.status === "IL"
  ).length;

  const fortyMan = result.filter(
    p => p.status === "40-MAN"
  ).length;

  console.log("================================");
  console.log("Phillies roster updated");
  console.log("================================");
  console.log(`ACTIVE : ${active}`);
  console.log(`IL     : ${il}`);
  console.log(`40-MAN : ${fortyMan}`);
  console.log(`TOTAL  : ${result.length}`);
  console.log("================================");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

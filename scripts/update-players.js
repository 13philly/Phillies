const fs = require("fs");

const API = "https://statsapi.mlb.com/api/v1";
const TEAM_ID = 143;

async function fetchJSON(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `MLB API request failed: ${response.status} ${url}`
    );
  }

  return response.json();
}

function classifyRosterStatus(entry) {
  const status = entry.status || {};

  const code = String(status.code || "").toUpperCase();
  const description = String(
    status.description || ""
  ).toLowerCase();

  /*
   * 保存対象
   * ACTIVE
   * IL
   * 40-MAN
   */

  if (
    code.includes("IL") ||
    description.includes("injured list")
  ) {
    return "IL";
  }

  if (
    code === "ACTIVE" ||
    description === "active"
  ) {
    return "ACTIVE";
  }

  if (
    code.includes("40") ||
    description.includes("40-man")
  ) {
    return "40-MAN";
  }

  return null;
}

function normalizePlayer(entry, person) {
  return {
    id: person.id,
    name: person.fullName || "",
    number: entry.jerseyNumber || "",
    position: entry.position?.abbreviation || "",
    positionName: entry.position?.name || "",
    status: classifyRosterStatus(entry),
    bats: person.batSide?.code || "",
    throws: person.pitchHand?.code || "",
    birthDate: person.birthDate || "",
    height: person.height || "",
    weight: person.weight || ""
  };
}

function sortPlayers(players) {
  const statusOrder = {
    ACTIVE: 0,
    IL: 1,
    "40-MAN": 2
  };

  return players.sort((a, b) => {
    const statusDifference =
      statusOrder[a.status] - statusOrder[b.status];

    if (statusDifference !== 0) {
      return statusDifference;
    }

    const aNumber = Number(a.number);
    const bNumber = Number(b.number);

    if (Number.isNaN(aNumber) && Number.isNaN(bNumber)) {
      return a.name.localeCompare(b.name);
    }

    if (Number.isNaN(aNumber)) return 1;
    if (Number.isNaN(bNumber)) return -1;

    return aNumber - bNumber;
  });
}

async function main() {
  console.log("Fetching Phillies roster...");

  const rosterData = await fetchJSON(
    `${API}/teams/${TEAM_ID}/roster`
  );

  const players = [];

  for (const entry of rosterData.roster || []) {
    const status = classifyRosterStatus(entry);

    /*
     * ACTIVE / IL / 40-MAN以外は
     * person APIにもアクセスしない。
     */
    if (!status) {
      continue;
    }

    const personData = await fetchJSON(
      `${API}/people/${entry.person.id}`
    );

    const person = personData.people?.[0];

    if (!person) {
      console.warn(
        `Person data not found: ${entry.person.id}`
      );
      continue;
    }

    players.push(
      normalizePlayer(entry, person)
    );
  }

  sortPlayers(players);

  const output = {
    team: {
      id: TEAM_ID,
      name: "Philadelphia Phillies",
      abbreviation: "PHI"
    },

    updatedAt: new Date().toISOString(),

    players
  };

  fs.mkdirSync("data", {
    recursive: true
  });

  fs.writeFileSync(
    "data/players.json",
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  const active = players.filter(
    player => player.status === "ACTIVE"
  ).length;

  const il = players.filter(
    player => player.status === "IL"
  ).length;

  const fortyMan = players.filter(
    player => player.status === "40-MAN"
  ).length;

  console.log("");
  console.log("Phillies roster updated.");
  console.log(`Total: ${players.length}`);
  console.log(`ACTIVE: ${active}`);
  console.log(`IL: ${il}`);
  console.log(`40-MAN: ${fortyMan}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

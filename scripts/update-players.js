const fs = require("fs");

const TEAM_ID = 143;
const API = "https://statsapi.mlb.com/api/v1";

async function getJSON(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${url}`);
  }

  return response.json();
}

async function main() {
  const fortyData = await getJSON(
    `${API}/teams/${TEAM_ID}/roster/40Man`
  );

  const activeData = await getJSON(
    `${API}/teams/${TEAM_ID}/roster/active`
  );

  const fortyRoster = fortyData.roster || [];
  const activeRoster = activeData.roster || [];

  if (!fortyRoster.length) {
    throw new Error("40-Man roster could not be retrieved.");
  }

  const activeIds = new Set(
    activeRoster
      .map(player => player.person?.id)
      .filter(Boolean)
  );

  const players = [];

  for (const rosterPlayer of fortyRoster) {
    const person = rosterPlayer.person;

    if (!person?.id) continue;

    const status = rosterPlayer.status || {};

    const code = String(status.code || "").toUpperCase();
    const description =
      String(status.description || "").toUpperCase();

    const rosterStatus =
      String(rosterPlayer.rosterStatus || "").toUpperCase();

    const text =
      `${code} ${description} ${rosterStatus}`;

    /*
     * 判定優先順位
     *
     * IL
     * ↓
     * ACTIVE
     * ↓
     * 40-MAN
     */

    const isIL =
      text.includes("IL") ||
      text.includes("INJURED LIST") ||
      text.includes("INJURED");

    let rosterType;

    if (isIL) {
      rosterType = "IL";
    } else if (activeIds.has(person.id)) {
      rosterType = "ACTIVE";
    } else {
      rosterType = "40-MAN";
    }

    players.push({
      id: person.id,
      name: person.fullName || "",
      firstName: person.firstName || "",
      lastName: person.lastName || "",
      jerseyNumber: rosterPlayer.jerseyNumber || null,

      position: {
        abbreviation:
          rosterPlayer.position?.abbreviation || "",
        name:
          rosterPlayer.position?.name || ""
      },

      bats: person.bats?.code || "",
      throws: person.pitchHand?.code || "",

      rosterType
    });
  }

  const priority = {
    IL: 0,
    ACTIVE: 1,
    "40-MAN": 2
  };

  players.sort((a, b) => {
    const p =
      priority[a.rosterType] -
      priority[b.rosterType];

    if (p !== 0) return p;

    return a.name.localeCompare(b.name);
  });

  const output = {
    updatedAt: new Date().toISOString(),
    source: "MLB StatsAPI",
    teamId: TEAM_ID,
    rosterBasis: "40-Man",
    players
  };

  fs.mkdirSync("data", { recursive: true });

  fs.writeFileSync(
    "data/players.json",
    JSON.stringify(output, null, 2) + "\n"
  );

  console.log(`40-Man: ${fortyRoster.length}`);
  console.log(
    `IL: ${players.filter(p => p.rosterType === "IL").length}`
  );
  console.log(
    `ACTIVE: ${players.filter(p => p.rosterType === "ACTIVE").length}`
  );
  console.log(
    `40-MAN: ${players.filter(p => p.rosterType === "40-MAN").length}`
  );
  console.log(`TOTAL SAVED: ${players.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

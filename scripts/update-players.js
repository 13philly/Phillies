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

function classifyStatus(entry) {
  const code = String(entry.status?.code || "").toUpperCase();
  const description =
    String(entry.status?.description || "").toLowerCase();

  if (
    code.includes("IL") ||
    description.includes("injured list")
  ) {
    return "IL";
  }

  if (
    code.includes("ACTIVE") ||
    description.includes("active")
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

async function main() {
  const roster = await getJSON(
    `${API}/teams/${TEAM_ID}/roster`
  );

  const players = [];

  for (const entry of roster.roster || []) {
    const status = classifyStatus(entry);

    if (!status) continue;

    const person = await getJSON(
      `${API}/people/${entry.person.id}`
    );

    const p = person.people?.[0] || {};
    const position = entry.position || {};

    players.push({
      id: p.id,
      name: p.fullName || entry.person.fullName || "",
      number: entry.jerseyNumber || "",
      position: position.abbreviation || "",
      positionName: position.name || "",
      status,
      bats: p.batSide?.code || "",
      throws: p.pitchHand?.code || "",
      birthDate: p.birthDate || "",
      height: p.height || "",
      weight: p.weight || ""
    });
  }

  players.sort((a, b) => {
    const order = {
      ACTIVE: 1,
      IL: 2,
      "40-MAN": 3
    };

    if (order[a.status] !== order[b.status]) {
      return order[a.status] - order[b.status];
    }

    const na = parseInt(a.number, 10);
    const nb = parseInt(b.number, 10);

    if (Number.isNaN(na)) return 1;
    if (Number.isNaN(nb)) return -1;

    return na - nb;
  });

  const data = {
    team: {
      id: TEAM_ID,
      name: "Philadelphia Phillies",
      abbreviation: "PHI"
    },
    updatedAt: new Date().toISOString(),
    players
  };

  fs.writeFileSync(
    "data/players.json",
    JSON.stringify(data, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `Saved ${players.length} players: ` +
    `${players.filter(p => p.status === "ACTIVE").length} ACTIVE, ` +
    `${players.filter(p => p.status === "IL").length} IL, ` +
    `${players.filter(p => p.status === "40-MAN").length} 40-MAN`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

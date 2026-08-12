const TEAM_ID = 143;
const SEASON = new Date().getFullYear();
const API = "https://statsapi.mlb.com/api/v1";

const fs = await import("node:fs/promises");
const path = await import("node:path");

const DATA_DIR = path.join(process.cwd(), "data");
const OUTPUT = path.join(DATA_DIR, "players.json");

async function getJSON(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Phillies-App/1.0"
    }
  });

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${url}`);
  }

  return res.json();
}

function value(obj, key) {
  return obj && obj[key] !== undefined ? obj[key] : null;
}

function classifyStatus(entry) {
  const code =
    entry?.status?.code ||
    entry?.status?.type ||
    entry?.status?.description ||
    "";

  const text = String(code).toLowerCase();

  if (
    text.includes("il") ||
    text.includes("injured") ||
    text.includes("10-day") ||
    text.includes("15-day") ||
    text.includes("60-day") ||
    text.includes("7-day")
  ) {
    return "IL";
  }

  if (
    text === "a" ||
    text.includes("active") ||
    text.includes("active roster")
  ) {
    return "ACTIVE";
  }

  return "40-MAN";
}

function isPitcher(player) {
  return player?.primaryPosition?.abbreviation === "P";
}

function isHitter(player) {
  return !isPitcher(player);
}

function findStat(people, type) {
  const stats = people?.stats || [];

  for (const group of stats) {
    if (group?.type?.displayName?.toLowerCase() === type.toLowerCase()) {
      const split = group?.splits?.[0];
      if (split?.stat) return split.stat;
    }

    if (group?.type?.name?.toLowerCase() === type.toLowerCase()) {
      const split = group?.splits?.[0];
      if (split?.stat) return split.stat;
    }
  }

  return null;
}

function pick(source, fields) {
  if (!source) {
    return Object.fromEntries(fields.map(key => [key, null]));
  }

  return Object.fromEntries(
    fields.map(key => [key, value(source, key)])
  );
}

function buildHitting(season, advanced, sabermetrics) {
  return {
    season: pick(season, [
      "gamesPlayed",
      "plateAppearances",
      "atBats",
      "runs",
      "hits",
      "doubles",
      "triples",
      "homeRuns",
      "rbi",
      "baseOnBalls",
      "strikeOuts",
      "stolenBases",
      "caughtStealing",
      "avg",
      "obp",
      "slg",
      "ops",
      "babip",
      "totalBases"
    ]),

    advanced: pick(advanced, [
      "iso",
      "pitchesPerPlateAppearance",
      "walksPerPlateAppearance",
      "strikeoutsPerPlateAppearance",
      "homeRunsPerPlateAppearance",
      "walksPerStrikeout",
      "extraBaseHits"
    ]),

    sabermetrics: pick(sabermetrics, [
      "war",
      "wpa",
      "wpaMinus",
      "wpaPlus",
      "re24",
      "wrcPlus",
      "wraa",
      "woba"
    ])
  };
}

function buildPitching(season, advanced, sabermetrics) {
  return {
    season: pick(season, [
      "gamesPlayed",
      "gamesStarted",
      "wins",
      "losses",
      "saves",
      "holds",
      "inningsPitched",
      "hits",
      "runs",
      "earnedRuns",
      "homeRuns",
      "baseOnBalls",
      "strikeOuts",
      "era",
      "whip"
    ]),

    advanced: pick(advanced, [
      "strikeoutsPer9Inn",
      "walksPer9Inn",
      "hitsPer9Inn",
      "homeRunsPer9",
      "strikeoutWalkRatio",
      "strikePercentage"
    ]),

    sabermetrics: pick(sabermetrics, [
      "war",
      "fip",
      "xfip",
      "siera",
      "wpa",
      "re24"
    ])
  };
}

async function main() {
  console.log(`Updating Phillies players: ${SEASON}`);

  /*
   * まず現在の40-manを取得。
   * 保存対象はこの集合だけ。
   */
  const rosterURL =
    `${API}/teams/${TEAM_ID}/roster?rosterType=40Man&season=${SEASON}`;

  const rosterData = await getJSON(rosterURL);

  const roster = rosterData.roster || [];

  if (!roster.length) {
    throw new Error("40-man roster is empty. Existing data will not be overwritten.");
  }

  const players = [];

  for (const entry of roster) {
    const personId = entry?.person?.id;

    if (!personId) continue;

    try {
      const personURL =
        `${API}/people/${personId}` +
        `?season=${SEASON}` +
        `&hydrate=` +
        `stats(group=[hitting,pitching],type=[season,seasonAdvanced,sabermetrics],season=${SEASON})`;

      const personData = await getJSON(personURL);
      const person = personData?.people?.[0];

      if (!person) continue;

      const seasonHitting = findStat(person, "season");
      const advancedHitting = findStat(person, "seasonAdvanced");
      const sabermetricsHitting = findStat(person, "sabermetrics");

      /*
       * person hydrationに複数groupが入るため、
       * groupを明示して取り出す。
       */
      const groups = person?.stats || [];

      function getGroupStat(groupName, typeName) {
        const group = groups.find(
          g =>
            String(g?.group?.displayName || g?.group?.name || "")
              .toLowerCase() === groupName &&
            String(g?.type?.displayName || g?.type?.name || "")
              .toLowerCase() === typeName.toLowerCase()
        );

        return group?.splits?.[0]?.stat || null;
      }

      const hittingSeason =
        getGroupStat("hitting", "season") || seasonHitting;

      const hittingAdvanced =
        getGroupStat("hitting", "seasonAdvanced") || advancedHitting;

      const hittingSabermetrics =
        getGroupStat("hitting", "sabermetrics") || sabermetricsHitting;

      const pitchingSeason =
        getGroupStat("pitching", "season");

      const pitchingAdvanced =
        getGroupStat("pitching", "seasonAdvanced");

      const pitchingSabermetrics =
        getGroupStat("pitching", "sabermetrics");

      const pitcher = isPitcher(person);

      const player = {
        id: person.id,
        name: person.fullName ?? null,

        firstName: person.firstName ?? null,
        lastName: person.lastName ?? null,

        number:
          person.primaryNumber ??
          entry.jerseyNumber ??
          null,

        position: {
          code: person.primaryPosition?.code ?? null,
          name: person.primaryPosition?.name ?? null,
          abbreviation:
            person.primaryPosition?.abbreviation ?? null
        },

        bt: {
          bats: person.batSide?.code ?? null,
          throws: person.pitchHand?.code ?? null
        },

        physical: {
          height: person.height ?? null,
          weight: person.weight ?? null,
          birthDate: person.birthDate ?? null,
          birthCity: person.birthCity ?? null,
          birthCountry: person.birthCountry ?? null
        },

        roster: {
          status: classifyStatus(entry),
          rosterType: "40-MAN",
          active: classifyStatus(entry) === "ACTIVE",
          injured: classifyStatus(entry) === "IL",
          fortyMan: true
        },

        stats: pitcher
          ? {
              type: "pitcher",
              pitching: buildPitching(
                pitchingSeason,
                pitchingAdvanced,
                pitchingSabermetrics
              ),
              hitting: null
            }
          : {
              type: "hitter",
              hitting: buildHitting(
                hittingSeason,
                hittingAdvanced,
                hittingSabermetrics
              ),
              pitching: null
            },

        updatedAt: new Date().toISOString()
      };

      players.push(player);

      console.log(
        `${player.name} -> ${player.roster.status} -> ${player.stats.type}`
      );

    } catch (error) {
      console.error(
        `Failed player ${personId}:`,
        error.message
      );
    }
  }

  if (!players.length) {
    throw new Error("No players collected. Existing data will not be overwritten.");
  }

  const output = {
    team: {
      id: TEAM_ID,
      name: "Philadelphia Phillies"
    },

    season: SEASON,

    updatedAt: new Date().toISOString(),

    source: "MLB Stats API",

    players
  };

  await fs.mkdir(DATA_DIR, { recursive: true });

  await fs.writeFile(
    OUTPUT,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log(`Saved ${players.length} players.`);
  console.log(OUTPUT);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

name: Update Phillies Players

on:
  schedule:
    - cron: "0 */6 * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  update-players:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Fetch Phillies roster
        env:
          TZ: America/New_York
        run: |
          mkdir -p data

          node <<'EOF'
          const fs = require("fs");

          const TEAM_ID = 143;

          async function getJSON(url) {
            const res = await fetch(url, {
              headers: {
                "User-Agent": "Phillies-Reader/1.0"
              }
            });

            if (!res.ok) {
              throw new Error(`${res.status} ${res.statusText}: ${url}`);
            }

            return res.json();
          }

          function normalizeName(name) {
            return String(name || "").trim().toLowerCase();
          }

          async function main() {
            /*
             * 1. 40-Manを母集団にする
             */
            const fortyManURL =
              `https://statsapi.mlb.com/api/v1/teams/${TEAM_ID}/roster/40Man`;

            /*
             * 2. Active Roster
             */
            const activeURL =
              `https://statsapi.mlb.com/api/v1/teams/${TEAM_ID}/roster/active`;

            /*
             * 3. 40-Man
             */
            const fortyMan = await getJSON(fortyManURL);
            const active = await getJSON(activeURL);

            const fortyPlayers = fortyMan.roster || [];
            const activePlayers = active.roster || [];

            /*
             * 40-Man IDを母集団として固定
             */
            const fortyIds = new Set(
              fortyPlayers
                .map(p => p.person?.id)
                .filter(Boolean)
            );

            /*
             * Active ID
             */
            const activeIds = new Set(
              activePlayers
                .map(p => p.person?.id)
                .filter(Boolean)
            );

            /*
             * 40-Man内の選手だけを判定
             *
             * 優先順位
             * IL
             * ↓
             * ACTIVE
             * ↓
             * 40-MAN
             */
            const players = [];

            for (const player of fortyPlayers) {
              const person = player.person || {};
              const id = person.id;

              if (!id) continue;

              let status = "40-MAN";

              /*
               * MLB APIのRoster statusを確認
               */
              const statusCode =
                String(player.status?.code || "").toUpperCase();

              const statusDescription =
                String(player.status?.description || "").toUpperCase();

              const rosterType =
                String(player.rosterStatus || "").toUpperCase();

              const fullStatus =
                `${statusCode} ${statusDescription} ${rosterType}`;

              /*
               * ILを最優先
               *
               * IL-10
               * IL-15
               * IL-60
               * Injured List
               * Disabled List系
               */
              const isIL =
                fullStatus.includes("IL") ||
                fullStatus.includes("INJURED");

              if (isIL) {
                status = "IL";
              } else if (activeIds.has(id)) {
                status = "ACTIVE";
              }

              players.push({
                id,
                name: person.fullName || "",
                firstName: person.firstName || "",
                lastName: person.lastName || "",
                position: player.position?.abbreviation || "",
                positionName: player.position?.name || "",
                bats: person.bats?.code || "",
                throws: person.pitchHand?.code || "",
                status,
                statusDetail: player.status?.description || "",
                teamId: TEAM_ID
              });
            }

            /*
             * 安全確認
             *
             * 40-Man取得に失敗して空になった場合、
             * 既存データを破壊しない。
             */
            if (!fortyPlayers.length) {
              throw new Error("40-Man roster is empty. Abort update.");
            }

            /*
             * 並び順
             * IL → ACTIVE → 40-MAN
             */
            const priority = {
              "IL": 0,
              "ACTIVE": 1,
              "40-MAN": 2
            };

            players.sort((a, b) => {
              const statusDiff =
                priority[a.status] - priority[b.status];

              if (statusDiff !== 0) {
                return statusDiff;
              }

              return normalizeName(a.name)
                .localeCompare(normalizeName(b.name));
            });

            const output = {
              updatedAt: new Date().toISOString(),
              source: "MLB StatsAPI",
              teamId: TEAM_ID,
              rosterBasis: "40-Man",
              statusPriority: [
                "IL",
                "ACTIVE",
                "40-MAN"
              ],
              players
            };

            fs.writeFileSync(
              "data/players.json",
              JSON.stringify(output, null, 2) + "\n"
            );

            console.log(
              `40-Man: ${fortyPlayers.length}`
            );

            console.log(
              `Saved: ${players.length}`
            );

            console.log(
              `IL: ${players.filter(p => p.status === "IL").length}`
            );

            console.log(
              `ACTIVE: ${players.filter(p => p.status === "ACTIVE").length}`
            );

            console.log(
              `40-MAN: ${players.filter(p => p.status === "40-MAN").length}`
            );
          }

          main().catch(error => {
            console.error(error);
            process.exit(1);
          });
          EOF

      - name: Commit updated data
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          git add data/players.json

          if git diff --cached --quiet; then
            echo "No changes."
          else
            git commit -m "Update Phillies player roster"
            git push
          fi

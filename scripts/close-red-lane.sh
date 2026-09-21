#!/usr/bin/env bash
set -euo pipefail

# The red lane issue stayed open after the lane went green: the E2E smoke one
# sat open through six days of green runs. Close it from the first green run,
# naming that run, so an open red lane issue always means the lane is red now.

LANE="${1:?lane name required}"
# Same title rule as report-red-lane.sh, so the dedupe search finds the issue
# that script opened.
TITLE="${RED_LANE_TITLE:-$LANE is red on main}"
RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

EXISTING="$(gh issue list --state open --search "\"$TITLE\" in:title" --json number,title \
  --jq "[.[] | select(.title == \"$TITLE\")] | .[0].number // empty")"

if [[ -z "$EXISTING" ]]; then
  echo "No open issue titled \"$TITLE\""
  exit 0
fi

gh issue close "$EXISTING" --comment "Green again: ${RUN_URL}
Commit: ${GITHUB_SHA}"
echo "Closed issue #$EXISTING"

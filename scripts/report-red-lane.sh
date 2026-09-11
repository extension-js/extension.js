#!/usr/bin/env bash
set -euo pipefail

# A red browser lane used to land only in the Actions tab, where nobody was
# looking: the September 8 regression sat there for four days. Put it in the
# issue tracker instead, one open issue per lane, commented on each failure.

LANE="${1:?lane name required}"
TITLE="$LANE is red on main"
RUN_URL="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
BODY="Failing run: ${RUN_URL}
Commit: ${GITHUB_SHA}

Reproduce locally:

\`\`\`
bash scripts/hydrate-templates-from-examples.sh
pnpm run test:e2e --project=chromium
\`\`\`"

EXISTING="$(gh issue list --state open --search "\"$TITLE\" in:title" --json number,title \
  --jq "[.[] | select(.title == \"$TITLE\")] | .[0].number // empty")"

if [[ -n "$EXISTING" ]]; then
  gh issue comment "$EXISTING" --body "$BODY"
  echo "Commented on issue #$EXISTING"
else
  gh issue create --title "$TITLE" --body "$BODY"
fi

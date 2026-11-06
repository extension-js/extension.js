#!/usr/bin/env bash
# Usage: verify-npm-publish.sh <dist-tag>, run in the package directory right
# after its `npm publish`. Waits for the version to be visible on npm.
#
# npm answers a publish with 202 and processes it afterwards, which took over
# two minutes on 2026-09-04 and seventeen minutes on 2026-10-22, so the wait
# is twenty minutes. npm also answers 202 for a publish it stages for a
# maintainer's approval, and a staged version stays invisible however long
# we wait. A second publish narrows it down: a lost one publishes again, and
# one npm is still processing or holding for approval answers 409
# "previously staged". `npm stage list` tells those two apart: a listed entry
# is a hold with an id to approve, so the script stops and names it, and an
# empty list earns one more wait before the script gives up.
set -u

TAG="${1:?usage: verify-npm-publish.sh <dist-tag>}"
POLLS="${VERIFY_NPM_POLLS:-80}"
INTERVAL="${VERIFY_NPM_INTERVAL:-15}"
PKG=$(node -p "require('./package.json').name")
VER=$(node -p "require('./package.json').version")

visible() {
  local i
  for ((i = 1; i <= $1; i++)); do
    if npm view "$PKG@$VER" version >/dev/null 2>&1; then
      echo "Found $PKG@$VER on npm."
      return 0
    fi
    echo "Waiting for npm replication... ($i/$1)"
    sleep "$INTERVAL"
  done
  return 1
}

# Prints the staged entry for this version as "<id> <json>" when npm lists
# one. The listing needs a credential npm may not grant this job, so an
# unreadable list answers nothing and the caller falls back to waiting.
staged_entry() {
  npm stage list "$PKG" --json 2>/dev/null | VER="$VER" node -e '
    let raw = ""
    process.stdin.on("data", (chunk) => { raw += chunk })
    process.stdin.on("end", () => {
      let list
      try { list = JSON.parse(raw) } catch { return }
      if (!Array.isArray(list)) list = Object.values(list || {}).flat()
      const entry = list.find((item) => item && JSON.stringify(item).includes(process.env.VER))
      if (!entry) return
      const id = entry.id || entry.stageId || entry.stage_id || ""
      console.log(`${id} ${JSON.stringify(entry)}`)
    })
  ' 2>/dev/null
}

echo "Verifying $PKG@$VER is visible on npm..."
visible "$POLLS" && exit 0

echo "Still not visible, publishing $PKG@$VER again to learn why..."
OUTPUT=$(npm publish --access public --tag "$TAG" --provenance 2>&1)
STATUS=$?
echo "$OUTPUT" | tail -n 5

if echo "$OUTPUT" | grep -qi "previously staged"; then
  STAGED=$(staged_entry)

  if [ -n "$STAGED" ]; then
    STAGE_ID=${STAGED%% *}
    echo "npm stage list names $PKG@$VER as staged: ${STAGED#* }"
    echo "::error::npm is holding $PKG@$VER for approval${STAGE_ID:+ as stage $STAGE_ID}. From a machine logged in to npm, run 'npm stage list $PKG' to read it and 'npm stage approve ${STAGE_ID:-<stage-id>}' to publish it. Then re-run the failed job or dispatch the publish workflow again on main: every package that already exists is skipped."
    exit 1
  fi

  echo "npm has $PKG@$VER but does not serve it yet, and 'npm stage list $PKG' answers nothing from this job: it is still processing the publish, or holding it where only a logged-in maintainer can see. Waiting once more..."
  visible "$POLLS" && exit 0
  MINUTES=$((POLLS * INTERVAL * 2 / 60))
  echo "::error::npm has held $PKG@$VER for $MINUTES minutes. From a machine logged in to npm, run 'npm stage list $PKG': a listed entry is a hold, 'npm stage approve <stage-id>' publishes it, and an empty list means npm is still processing it (the 2026-11-03 canary took five and a half hours). Then re-run the failed job or dispatch the publish workflow again on main: every package that already exists is skipped."
  exit 1
fi

if [ "$STATUS" -eq 0 ] && visible "$POLLS"; then
  exit 0
fi

echo "Publish not visible on npm after waiting." >&2
exit 1

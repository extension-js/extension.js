#!/usr/bin/env bash
# Usage: verify-npm-publish.sh <dist-tag>, run in the package directory right
# after its `npm publish`. Waits for the version to be visible on npm.
#
# npm answers a publish with 202 and processes it afterwards, which once took
# over two minutes, so the wait is ten minutes. npm also answers 202 for a
# publish it stages for a maintainer's approval, and a staged version stays
# invisible however long we wait. A second publish tells the two apart: a
# staged version answers 409 "previously staged", a lost one publishes again.
set -u

TAG="${1:?usage: verify-npm-publish.sh <dist-tag>}"
POLLS="${VERIFY_NPM_POLLS:-40}"
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

echo "Verifying $PKG@$VER is visible on npm..."
visible "$POLLS" && exit 0

echo "Still not visible, publishing $PKG@$VER again to learn why..."
OUTPUT=$(npm publish --access public --tag "$TAG" --provenance 2>&1)
STATUS=$?
echo "$OUTPUT" | tail -n 5

if echo "$OUTPUT" | grep -qi "previously staged"; then
  echo "::error::npm staged $PKG@$VER for a maintainer's approval instead of publishing it. Approve it on npmjs.com, then rerun this run with --failed: every package that already exists is skipped."
  exit 1
fi

if [ "$STATUS" -eq 0 ] && visible "$POLLS"; then
  exit 0
fi

echo "Publish not visible on npm after waiting." >&2
exit 1

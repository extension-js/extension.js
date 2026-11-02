#!/usr/bin/env bash
# Usage: npm-publish.sh <dist-tag>, run in the package directory. Publishes the
# package with provenance, the same command the release job ran inline.
#
# Sigstore's transparency log can record an entry while answering 502. npm's
# own retry then gets 409 "an equivalent entry already exists"
# (TLOG_CREATE_ENTRY_ERROR) and stops before the registry upload, so the
# package is missing while the ones before it shipped. A new publish signs
# again and gets a new entry, so that one failure earns another attempt while
# the version is still absent. Every other failure exits as npm did.
set -u

TAG="${1:?usage: npm-publish.sh <dist-tag>}"
ATTEMPTS="${NPM_PUBLISH_ATTEMPTS:-2}"
WAIT="${NPM_PUBLISH_RETRY_WAIT:-20}"
PKG=$(node -p "require('./package.json').name")
VER=$(node -p "require('./package.json').version")

attempt=1

while :; do
  log=$(mktemp)
  npm publish --access public --tag "$TAG" --provenance 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}

  if [ "$status" -eq 0 ]; then
    rm -f "$log"
    exit 0
  fi

  if ! grep -q "TLOG_CREATE_ENTRY_ERROR" "$log"; then
    rm -f "$log"
    exit "$status"
  fi

  rm -f "$log"

  if npm view "$PKG@$VER" version >/dev/null 2>&1; then
    echo "$PKG@$VER is on npm despite the transparency log error."
    exit 0
  fi

  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "$PKG@$VER hit the transparency log error on all $attempt attempts." >&2
    echo "Rerun the failed job once Sigstore answers again: gh run rerun <run-id> --failed" >&2
    exit "$status"
  fi

  attempt=$((attempt + 1))
  echo "Transparency log error and $PKG@$VER is not on npm, publishing again in ${WAIT}s (attempt $attempt of $ATTEMPTS)."
  sleep "$WAIT"
done

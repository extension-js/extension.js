#!/usr/bin/env bash
set -euo pipefail

# The default `javascript` template ships bundled inside the npm package
# (programs/create/templates/javascript) as an offline fast-path, while
# extension-js/examples remains the source of truth (discussion #478).
# Nothing kept the two in sync, so improvements landing in examples never
# reached fresh scaffolds. This guard diffs the bundled copy against the
# examples repo and fails on drift, printing the exact resync command.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLED_DIR="$ROOT_DIR/programs/create/templates/javascript"
REPO_URL="https://github.com/extension-js/examples"
PIN_FILE="$ROOT_DIR/programs/create/steps/import-external-template.ts"

# Compare against the commit the scaffolder downloads, not the branch tip. The
# bundled copy is the offline twin of a networked create, and a networked create
# is pinned, so diffing it against main reported drift that no user could see
# and hid drift that every user could.
PINNED_REF="$(sed -n "s/^export const DEFAULT_TEMPLATES_REF = '\([0-9a-f]\{40\}\)'$/\1/p" "$PIN_FILE")"
if [[ -z "$PINNED_REF" ]]; then
  echo "error: could not read DEFAULT_TEMPLATES_REF from $PIN_FILE" >&2
  exit 1
fi
EXAMPLES_REF="${EXAMPLES_REF:-$PINNED_REF}"

# Diffing at the pin is right (see above), but it means anything examples
# changes AFTER the pin date is invisible here. That is how the bundled
# .gitignore drifted for four days: the pin predated the change by one day, so
# the guard compared against a snapshot that could not contain it and passed.
# The blindness is a property of pin AGE, so report it rather than let it grow
# silently. Two different findings, two different severities.
report_pin_health() {
  local probe="$TMP_DIR/pin-health"
  git clone --quiet --filter=blob:none "$REPO_URL" "$probe" 2>/dev/null || return 0

  # An unreachable pin is a real defect, not staleness: 4.0.30 shipped pinned to
  # a bot commit that GitHub happened to still serve, and a pin GitHub stops
  # serving breaks `create` for every user at once.
  if ! git -C "$probe" merge-base --is-ancestor "$PINNED_REF" origin/main 2>/dev/null; then
    echo "error: DEFAULT_TEMPLATES_REF $PINNED_REF is not an ancestor of" >&2
    echo "$REPO_URL main. A pin off the branch can stop resolving without warning." >&2
    echo "Move it with: node scripts/generate-template-corpus.mjs --ref <sha>" >&2
    return 1
  fi

  local behind
  behind="$(git -C "$probe" rev-list --count "$PINNED_REF..origin/main" 2>/dev/null || echo 0)"
  if [[ "$behind" -gt 0 ]]; then
    echo "note: the template pin is $behind commit(s) behind examples main."
    echo "      Anything changed there since is invisible to this check, and new"
    echo "      templates cannot be scaffolded by the shipped CLI until it moves."
  fi
}

if [[ "${EXTENSION_SKIP_TEMPLATE_DRIFT:-}" == "1" ]]; then
  echo "EXTENSION_SKIP_TEMPLATE_DRIFT=1 — skipping bundled template drift check."
  exit 0
fi

# Examples-repo files that never ship in the bundled copy: gallery/E2E
# scaffolding (stripped at create time anyway, see TEMPLATE_SCAFFOLDING_FILES
# in programs/create/steps/import-external-template.ts) plus build artifacts.
EXCLUDES=(
  node_modules
  dist
  pnpm-lock.yaml
  screenshot.png
  template.spec.ts
  template.meta.json
)

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Checking bundled javascript template against extension-js/examples @ ${EXAMPLES_REF}"
if git clone --depth 1 --branch "$EXAMPLES_REF" "$REPO_URL" "$TMP_DIR/examples" 2>/dev/null; then
  :
else
  git clone "$REPO_URL" "$TMP_DIR/examples"
  git -C "$TMP_DIR/examples" checkout "$EXAMPLES_REF"
fi

UPSTREAM_DIR="$TMP_DIR/examples/examples/javascript"
[[ -d "$UPSTREAM_DIR" ]] || {
  echo "error: examples/javascript not found in $REPO_URL @ $EXAMPLES_REF" >&2
  exit 1
}

DIFF_ARGS=(-r -u)
for name in "${EXCLUDES[@]}"; do
  DIFF_ARGS+=(--exclude "$name")
done

if diff "${DIFF_ARGS[@]}" "$BUNDLED_DIR" "$UPSTREAM_DIR"; then
  echo "Bundled javascript template is in sync with extension-js/examples."
  report_pin_health || exit 1
  exit 0
fi

cat >&2 <<EOF

error: programs/create/templates/javascript has drifted from
$REPO_URL/tree/$EXAMPLES_REF/examples/javascript (the pinned source of truth).
Fresh 'extension create' scaffolds use the bundled copy, so this drift
ships to users. Resync from a checkout of the examples repo:

  rsync -a --delete $(printf -- '--exclude %s ' "${EXCLUDES[@]}")\\
    <examples-checkout>/examples/javascript/ programs/create/templates/javascript/

EOF
exit 1

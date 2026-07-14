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
EXAMPLES_REF="${EXAMPLES_REF:-main}"

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
  exit 0
fi

cat >&2 <<EOF

error: programs/create/templates/javascript has drifted from
$REPO_URL/tree/main/examples/javascript (source of truth).
Fresh 'extension create' scaffolds use the bundled copy, so this drift
ships to users. Resync from a checkout of the examples repo:

  rsync -a --delete $(printf -- '--exclude %s ' "${EXCLUDES[@]}")\\
    <examples-checkout>/examples/javascript/ programs/create/templates/javascript/

EOF
exit 1

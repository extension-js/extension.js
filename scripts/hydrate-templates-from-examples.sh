#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATES_DIR="$ROOT_DIR/templates"
SCRIPTS_DIR="$ROOT_DIR/scripts"
REPO_URL="https://github.com/extension-js/examples"

has_required_templates() {
  local required=("typescript" "react" "svelte" "vue")
  for name in "${required[@]}"; do
    [[ -f "$TEMPLATES_DIR/$name/src/manifest.json" ]] || return 1
    [[ -f "$TEMPLATES_DIR/$name/template.spec.ts" ]] || return 1
    [[ -f "$TEMPLATES_DIR/$name/package.json" ]] || return 1
  done

  [[ -f "$TEMPLATES_DIR/extension-fixtures.ts" ]] || return 1
  [[ -f "$TEMPLATES_DIR/dirname.ts" ]] || return 1
  [[ -f "$SCRIPTS_DIR/build-with-manifest.mjs" ]] || return 1
}

if has_required_templates; then
  echo "Templates already hydrated. Skipping fetch."
  exit 0
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Hydrating templates from extension-js/examples"
git clone --depth 1 "$REPO_URL" "$TMP_DIR/examples"

mkdir -p "$TEMPLATES_DIR" "$SCRIPTS_DIR"
cp -R "$TMP_DIR/examples/examples/." "$TEMPLATES_DIR/"
cp "$TMP_DIR/examples/ci-scripts/build-with-manifest.mjs" "$SCRIPTS_DIR/build-with-manifest.mjs" 2>/dev/null || true

echo "Templates hydrated from extension-js/examples."

#!/bin/bash

set -e

# Define plugin file paths
html_plugin_files=(
  "$(dirname "$0")/webpack/plugin-extension/feature-html/steps/ensure-hmr-for-scripts.ts"
)

resolve_plugin_files=(
  "$(dirname "$0")/webpack/plugin-extension/feature-resolve/steps/resolver-loader.ts"
  # Defined in line 32 since it needs to be executed in esm format
  # "$(dirname "$0")/webpack/plugin-extension/feature-resolve/steps/resolver-module.ts"
)

scripts_plugin_files=(
  "$(dirname "$0")/webpack/plugin-extension/feature-scripts/steps/inject-content-css-during-dev.ts"
  "$(dirname "$0")/webpack/plugin-extension/feature-scripts/steps/add-hmr-accept-code.ts"
)

reload_plugin_files=(
  "$(dirname "$0")/webpack/plugin-reload/steps/setup-chromium-reload-client/inject-chromium-client-loader.ts"
  "$(dirname "$0")/webpack/plugin-reload/steps/setup-firefox-reload-client/inject-firefox-client-loader.ts"
)

# Separate minimum files for esm format
minimum_files=(
  "$(dirname "$0")/webpack/plugin-extension/feature-scripts/steps/minimum-content-file.ts"
  "$(dirname "$0")/webpack/plugin-reload/steps/setup-chromium-reload-client/minimum-chromium-file.ts"
  "$(dirname "$0")/webpack/plugin-reload/steps/setup-firefox-reload-client/minimum-firefox-file.ts"
  "$(dirname "$0")/webpack/plugin-extension/feature-html/steps/minimum-script-file.ts"
  "$(dirname "$0")/webpack/plugin-extension/feature-resolve/steps/resolver-module.ts"
)

# Define the tsup function
tsup() {
  local entrypoint=$1
  local format=$2
  echo "node_modules/.bin/tsup-node $entrypoint --format $format --target=node20 --minify"
}

# Execute tsup command
execute_command() {
  local entry=$1
  local format=$2
  command=$(tsup "$entry" "$format")
  # Execute the command and redirect output to /dev/null
  $command > /dev/null 2>&1

  code=$?
  if [ $code -ne 0 ]; then
    echo "[ERROR] Command failed with exit code $code for entry: $entry"
    exit $code
  fi
}

# Ensure dist directory exists
mkdir -p "$(dirname "$0")/dist/"

echo '►►► Setting up HTML loaders'
for entry in "${html_plugin_files[@]}"; do
  # echo "Processing HTML loader: $entry"
  execute_command "$entry" "cjs"
done

echo '►►► Setting up resolver loaders'
for entry in "${resolve_plugin_files[@]}"; do
  # echo "Processing resolver loader: $entry"
  execute_command "$entry" "cjs"
done

echo '►►► Setting up script loaders'
for entry in "${scripts_plugin_files[@]}"; do
  # echo "Processing script loader: $entry"
  execute_command "$entry" "cjs"
done

echo '►►► Setting up reload loaders'
for entry in "${reload_plugin_files[@]}"; do
  # echo "Processing reload loader: $entry"
  execute_command "$entry" "cjs"
done

echo '►►► Setting up minimum required files (ESM format)'
for entry in "${minimum_files[@]}"; do
  # echo "Processing minimum file: $entry"
  execute_command "$entry" "esm"
done

echo '►►► Setting up client helper files'
static_files=(
  "$(dirname "$0")/tailwind.config.js"
  "$(dirname "$0")/stylelint.config.json"
  "$(dirname "$0")/webpack/plugin-reload/extensions"
)

for file in "${static_files[@]}"; do
  if [ -e "$file" ]; then
    # echo "Copying $file to $(dirname "$0")/dist/"
    cp -r "$file" "$(dirname "$0")/dist/"
  else
    echo "File $file does not exist"
  fi
done

echo '►►► All tasks completed'

#!/bin/bash

set -e

plugin_loader_path() {
  local base_folder=$1
  local plugin_folder=$2
  local filename=$3
  echo "$(dirname "$0")/webpack/$base_folder/$plugin_folder/steps/$filename"
}

html_plugin_files=(
  # "$(plugin_loader_path 'plugin-extension' 'feature-html' 'ensure-hmr-for-scripts.ts')"
)

resolve_plugin_files=(
  # "$(plugin_loader_path 'plugin-extension' 'feature-resolve' 'resolver-loader.ts')"
  # "$(plugin_loader_path 'plugin-extension' 'feature-resolve' 'resolver-module.ts')"
)

scripts_plugin_files=(
  "$(plugin_loader_path 'plugin-extension' 'feature-scripts' 'inject-content-css-during-dev.ts')"
  "$(plugin_loader_path 'plugin-extension' 'feature-scripts' 'add-hmr-accept-code.ts')"
  "$(plugin_loader_path 'plugin-extension' 'feature-scripts' 'add-dynamic-public-path.ts')"
  "$(plugin_loader_path 'plugin-extension' 'feature-scripts' 'add-query-param-to-imported-css.ts')"
)

reload_plugin_files=(
  "$(dirname "$0")/webpack/plugin-reload/steps/add-runtime-listener/inject-background-runtime-loader.ts"
)

# Separate minimum files for esm format
minimum_files=(
  "$(dirname "$0")/webpack/plugin-extension/feature-scripts/steps/minimum-content-file.ts"
  "$(dirname "$0")/webpack/plugin-reload/steps/add-runtime-listener/minimum-background-file.ts"
  # "$(plugin_loader_path 'plugin-extension' 'feature-html' 'minimum-script-file.ts')"
)

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
  # echo "[develop] process exited with code $code for entry: $entry"
}

# Copy required files to dist directory
copy_files_to_dist() {
  local files=(
    "tailwind.config.js"
    "stylelint.config.js"
    "commands/dev/types"
    "webpack/plugin-reload/extensions"
  )
  for file in "${files[@]}"; do
    if [ -e "$file" ]; then
      # echo "Copying $file to dist/"
      cp -r "$file" dist/
    else
      echo "File $file does not exist"
    fi
  done
}

echo '►►► Setting up HTML loaders'
for entry in "${html_plugin_files[@]}"; do
  execute_command "$entry" "cjs"
done

echo '►►► Setting up resolver loaders'
for entry in "${resolve_plugin_files[@]}"; do
  execute_command "$entry" "cjs"
done

echo '►►► Setting up script loaders'
for entry in "${scripts_plugin_files[@]}"; do
  execute_command "$entry" "cjs"
done

echo '►►► Setting up reload loaders'
for entry in "${reload_plugin_files[@]}"; do
  execute_command "$entry" "cjs"
done

echo '►►► Setting up minimum required files (ESM format)'
for entry in "${minimum_files[@]}"; do
  execute_command "$entry" "esm"
done

# echo '►►► Building core module'
# execute_command "$(dirname "$0")/module.ts" "cjs"

echo '►►► Setting up client helper files'
copy_files_to_dist

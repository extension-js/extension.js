#!/bin/bash

set -e

# Ensure dist directory exists
mkdir -p "$(dirname "$0")/dist/"

echo '►►► Setting up client helper files'
static_files=(
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

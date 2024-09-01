#!/bin/bash

set -e

echo '►►► Generating client types/ folder'
static_files=(
  "$(dirname "$0")/types"
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

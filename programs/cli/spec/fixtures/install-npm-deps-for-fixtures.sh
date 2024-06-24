#!/bin/bash

# Navigate to the fixtures directory
cd ./spec/fixtures/

# Loop through each top-level directory
for dir in */; do
  if [ -d "$dir" ]; then
    echo "Running npm install in $dir"
    (cd "$dir" && npm install)
  fi
done

echo "All installations are complete."
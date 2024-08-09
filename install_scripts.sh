#!/bin/bash

# Iterate over each top-level folder in ./examples/
for dir in ./examples/*/ ; do
  if [ -d "$dir" ]; then
    echo "Entering directory: $dir"
    cd "$dir"
    echo "Running npm install in $dir"
    npm install
    cd - > /dev/null
  fi
done

echo "npm install completed in all top-level folders within ./examples/"

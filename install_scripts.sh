#!/bin/bash

# Iterate over each top-level folder in ./examples/
for dir in ./examples/*/ ; do
  if [ -d "$dir" ]; then
    echo "Entering directory: $dir"
    cd "$dir"
    echo "Running yarn in $dir"
    yarn
    cd - > /dev/null
  fi
done

echo "yarn completed in all top-level folders within ./examples/"

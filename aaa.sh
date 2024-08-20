#!/bin/bash

# Function to remove lock files
remove_lock_files() {
    local dir="$1"

    # Find and remove package-lock.json and yarn.lock files
    find "$dir" -maxdepth 1 -type f \( -name "package-lock.json" -o -name "yarn.lock" \) -exec rm -v {} +
}

# Start the removal from the ./examples/ directory
for example_dir in ./examples/*; do
    if [ -d "$example_dir" ]; then
        remove_lock_files "$example_dir"
    fi
done

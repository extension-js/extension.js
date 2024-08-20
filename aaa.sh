#!/bin/bash

# Get the absolute path of the root directory
ROOT_DIR=$(pwd)

# Function to recursively remove .git folders
remove_git_folders() {
    local dir="$1"

    # Iterate over all directories in the current directory
    for subdir in "$dir"/*; do
        if [ -d "$subdir" ]; then
            # Skip node_modules directories
            if [[ $(basename "$subdir") == "node_modules" ]]; then
                continue
            fi

            # Remove .git directory if it's not the root level
            if [[ $(basename "$subdir") == ".git" ]] && [[ "$subdir" != "$ROOT_DIR/.git" ]]; then
                echo "Removing $subdir"
                rm -rf "$subdir"
            fi

            # Recurse into subdirectories
            remove_git_folders "$subdir"
        fi
    done
}

# Start the recursive removal from the current directory
remove_git_folders "$ROOT_DIR"

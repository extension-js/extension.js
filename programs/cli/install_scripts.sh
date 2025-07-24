#!/bin/bash

set -e

echo '►►► Copying README.md to CLI directory'

# Get the directory of the current script
SCRIPT_DIR="$(dirname "$0")"
# Get the root directory (3 levels up from the script)
ROOT_DIR="$(dirname "$SCRIPT_DIR")/../.."
# Get the CLI directory (1 level up from the script)
CLI_DIR="$(dirname "$SCRIPT_DIR")"

# Source and target paths
SOURCE_README="$ROOT_DIR/README.md"
TARGET_README="$CLI_DIR/README.md"

# Function to copy and modify file if content is different
copy_and_modify_if_different() {
    local source="$1"
    local target="$2"
    
    if [ -f "$source" ]; then
        if [ -f "$target" ]; then
            # Compare files
            if ! cmp -s "$source" "$target"; then
                # Create a temporary file
                TMP_FILE=$(mktemp)
                # Copy and modify the content
                sed -e 's/width="20%"/width="15.5%"/' \
                    -e '/\[coverage-image\].*coverage-url\]/d' \
                    "$source" > "$TMP_FILE"
                # Move the modified content to target
                mv "$TMP_FILE" "$target"
                echo "[Extension.js setup] File $(basename "$source") copied and modified to $target"
            else
                echo "[Extension.js setup] File $(basename "$source") haven't changed. Skipping copy..."
            fi
        else
            # Target doesn't exist, create with modifications
            sed -e 's/width="20%"/width="15.5%"/' \
                -e '/\[coverage-image\].*coverage-url\]/d' \
                "$source" > "$target"
            echo "[Extension.js setup] File $(basename "$source") copied and modified to $target"
        fi
    else
        echo "Error: Source file $source not found"
        exit 1
    fi
}

# Copy and modify README.md
copy_and_modify_if_different "$SOURCE_README" "$TARGET_README"

echo '►►► All tasks completed'
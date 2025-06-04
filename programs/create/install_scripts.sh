#!/bin/bash

set -e

# Define source and destination paths
src_template="$(dirname "$0")/template"
dest_template="$(dirname "$0")/dist"

# Ensure the destination directory exists
mkdir -p "$dest_template"

# Copy the template directory to the dist folder
echo '►►► Copying template to distribution folder'
cp -r "$src_template" "$dest_template"

echo '►►► Template copied successfully'

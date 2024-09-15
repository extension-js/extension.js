#!/bin/bash

# Set the base directory
BASE_DIR="./examples"

# Find and delete all "dist" directories inside the ./examples/* directories
find "$BASE_DIR" -type d -name "dist" -exec rm -rf {} +

echo "All 'dist' directories inside $BASE_DIR have been deleted."

#!/usr/bin/env node
// Sync root README.md to programs/cli/README.md (public-facing npm package)
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const src = path.join(root, 'README.md');
const dest = path.join(root, 'programs', 'cli', 'README.md');

function main() {
    if (!fs.existsSync(src)) {
        console.error('Root README.md not found');
        process.exit(1);
    }
    const content = fs.readFileSync(src, 'utf8');
    fs.writeFileSync(dest, content);
    console.log(`Synced README.md -> ${path.relative(root, dest)}`);
}

main();



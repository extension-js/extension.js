#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const distCjsEntry = path.resolve(__dirname, '../dist/cli.cjs')
const distEntry = path.resolve(__dirname, '../dist/cli.js')
const sourceEntry = path.resolve(__dirname, '../index.ts')

const run = (entry) => {
  require(entry)
}

if (fs.existsSync(distCjsEntry)) {
  run(distCjsEntry)
} else if (fs.existsSync(distEntry)) {
  run(distEntry)
} else if (fs.existsSync(sourceEntry)) {
  try {
    const {spawnSync} = require('child_process')
    const tsxCli = require.resolve('tsx/cli')
    const result = spawnSync(
      process.execPath,
      [tsxCli, sourceEntry, ...process.argv.slice(2)],
      {stdio: 'inherit'}
    )
    process.exit(result.status ?? 1)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[Extension.js] CLI not built. Run "pnpm --filter extension compile".'
    )
    process.exit(1)
  }
} else {
  // eslint-disable-next-line no-console
  console.error('[Extension.js] CLI entry not found.')
  process.exit(1)
}

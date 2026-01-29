#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const distEntry = path.resolve(__dirname, '../dist/cli.js')
const sourceEntry = path.resolve(__dirname, '../index.ts')

if (fs.existsSync(distEntry)) {
  require(distEntry)
  return
}

if (fs.existsSync(sourceEntry)) {
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
}

// eslint-disable-next-line no-console
console.error('[Extension.js] CLI entry not found.')
process.exit(1)

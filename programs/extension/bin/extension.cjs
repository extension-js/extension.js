#!/usr/bin/env node

//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

'use strict'

const fs = require('node:fs')
const path = require('node:path')

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
    const {spawnSync} = require('node:child_process')
    const tsxCli = require.resolve('tsx/cli')
    const result = spawnSync(
      process.execPath,
      [tsxCli, sourceEntry, ...process.argv.slice(2)],
      {stdio: 'inherit'}
    )
    process.exit(result.status ?? 1)
  } catch {
    console.error(
      '[Extension.js] CLI not built. Run "pnpm --filter extension compile".'
    )

    process.exit(1)
  }
} else {
  console.error('[Extension.js] CLI entry not found.')
  process.exit(1)
}

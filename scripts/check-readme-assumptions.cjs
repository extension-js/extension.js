#!/usr/bin/env node
// Validate assumptions in root README.md and CLI availability
const fs = require('fs')
const path = require('path')
const {spawnSync} = require('child_process')

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

const root = process.cwd()
const readmePath = path.join(root, 'README.md')
if (!fs.existsSync(readmePath)) fail('README.md not found at repository root')

const readme = fs.readFileSync(readmePath, 'utf8')

// Required sections/headings
const requiredHeadings = [
  '## Create A New Extension',
  '## Get Started Immediately',
  '## I have An Extension',
  '## Using a specific browser for development'
]

for (const h of requiredHeadings) {
  if (!readme.includes(h)) fail(`Missing required README section: ${h}`)
}

// Required command strings
const requiredSnippets = [
  'npx extension@latest create',
  'extension build',
  'extension dev',
  'extension preview'
]

for (const s of requiredSnippets) {
  if (!readme.includes(s)) fail(`Missing required README command snippet: ${s}`)
}

// CLI help should expose the referenced commands
const cliPath = path.join(root, 'programs', 'cli', 'dist', 'cli.js')
if (!fs.existsSync(cliPath)) fail('CLI binary not found. Did you build the CLI?')

const help = spawnSync(process.execPath, [cliPath, '--help'], {
  encoding: 'utf8'
})
if (help.status !== 0) fail(`CLI --help failed with code ${help.status}`)
const helpOut = [help.stdout, help.stderr].join('\n')

const helpCommands = ['create', 'dev', 'build', 'preview']
for (const cmd of helpCommands) {
  if (!helpOut.toLowerCase().includes(cmd)) {
    fail(`CLI help does not mention command: ${cmd}`)
  }
}

console.log('README assumptions validated successfully.')


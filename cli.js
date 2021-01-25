#!/usr/bin/env node

const {program} = require('commander')
const semver = require('semver')

const isKeyword = require('./reservedKeywords')
const packageJson = require('./package.json')
const createExtensionCLI = require('./create')
const developExtensionCLI = require('./develop')
const messages = require('./messages')

if (semver.lte(process.version, '10.3.0')) {
  messages.nodeVersionNotSupported()
  process.exit(1)
}

const extensionCreate = program

extensionCreate
  .version(packageJson.version)
  .on('--help', () => messages.help())

// We support creating new extensions without
// an explicit `create` command but this convenience
// allows user to add projects using command names.
// In this case we check first if command is a keyword
// and only run create if it's not.
if (!isKeyword()) {
  const argument = process.argv[process.argv.length - 1]

  // This operation is a mistake, warn user.
  if (argument.startsWith('http')) {
    messages.noURLWithoutStart(argument)
    process.exit()
  }

  createExtensionCLI(extensionCreate)
} else {
  developExtensionCLI(extensionCreate)
}

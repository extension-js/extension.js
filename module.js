#!/usr/bin/env node

const isKeyword = require('./reservedKeywords')

const cli = require('./cli')

cli()

// We support creating new extensions without
// an explicit `create` command but this convenience
// allows user to add projects using command names.
// In this case we check first if command is a keyword
// and only run create if it's not.
if (!isKeyword()) {
  const createExtensionCLI = require('./create')
  createExtensionCLI()
} else {
  const developExtensionCLI = require('./develop')
  developExtensionCLI()
}

/* global describe, it */
const path = require('path')

const fs = require('fs-extra')

const boringManifestFile = {
  manifest_version: 2,
  name: 'Your browser extension',
  version: '1.0',
  background: {
    scripts: ['./background.js']
  }
}

/* eslint-disable no-unused-vars */
async function createTmpExtension() {
  // Write a fake bg script
  await fs.writeFile(
    path.join(process.cwd(), 'background.js'),
    'console.log("hello")'
  )
  // Write a fake manifest file
  await fs.writeFile(
    path.join(process.cwd(), 'manifest.json'),
    JSON.stringify(boringManifestFile)
  )
}

describe('`start` command line interface', () => {
  it.todo('starts extension from local path with arguments')
  it.todo('starts extension from local path without arguments')
  it.todo('starts extension from local path - manifest in src/')
  it.todo('starts extension from local path - manifest in public/')
  it.todo('starts extension from remote (URL) path')
  it.todo('starts extension from remote (URL) path - manifest in src/')
  it.todo('starts extension from remote (URL) path - manifest in public/')
  describe('--browser flag', () => {
    it.todo('accepts and starts `chrome` as flag')
    it.todo('accepts and starts `edge` as flag')
    it.todo('accepts and `all` browsers as flag')
    it.todo('accepts and starts chrome as default')
  })
})

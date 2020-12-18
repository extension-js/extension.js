/* global describe, it */
const path = require('path')

const fs = require('fs-extra')

const boringManifestFile = {
  manifest_version: 2,
  name: 'Your browser extension',
  version: '1.0',
  background: {
    scripts: [
      './background.js'
    ]
  }
}

/* eslint-disable no-unused-vars */
async function createTmpExtension () {
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
  it.todo('calls browser with a resolved manifest path')
  it.todo('warns users if manifest file is missing')

  describe('-m, --manifest', () => {
    it.todo('warns users if manifest flag is empty')
    it.todo('starts an extension with a custom manifest file path')
  })
})

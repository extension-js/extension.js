/* global describe, afterEach, it, expect */
const path = require('path')

const spawn = require('cross-spawn')
const fs = require('fs-extra')

describe('`create` command line interface', () => {
  const createExtensionCLI = path.resolve(__dirname, './cli.js')
  const projectName = 'my-extension-home'
  const outputpath = path.resolve(process.cwd(), projectName)

  afterEach(async () => {
    // Clear filesystem after running tests
    await fs.remove(outputpath)
  })

  it('creates an extension with specified project name', async () => {
    expect.assertions(1)
    spawn.sync(
      'node',
      [createExtensionCLI, 'my-extension-home'],
      {stdio: 'inherit'}
    )

    const pathStat = await fs.stat(outputpath)
    const isDirectory = pathStat.isDirectory()

    expect(isDirectory).toBe(true)
  })

  it.todo('warns users if destination folder is not empty')

  describe('-t, --template', () => {
    it.todo('creates an extension by consuming a template')
    it.todo('warns users if template flag is empty')
  })
})

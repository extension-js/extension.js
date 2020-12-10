/* global describe, afterEach, it, expect */
const path = require('path')

const spawn = require('cross-spawn')
const fs = require('fs-extra')

describe('createBrowserExtension', () => {
  const createBrowserExtension = path.resolve(__dirname, './module.js')
  const projectName = 'my-extension-home'
  const outputpath = path.resolve(__dirname, projectName)

  afterEach(async () => {
    // Clear filesystem after running tests
    await fs.rmdir(outputpath, { recursive: true })
  })

  describe('`create` command line interface', () => {
    it('creates a folder with specified project name', async (done) => {
      spawn.sync(
        'node',
        [createBrowserExtension, 'my-extension-home'],
        { stdio: 'inherit' }
      )

      const pathStat = await fs.stat(outputpath)
      const isDirectory = pathStat.isDirectory()

      expect(isDirectory).toBe(true)
      done()
    })
  })
})

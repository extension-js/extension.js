import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {loadUserPostCssConfigObject} from '../css-tools/postcss'
import {cssProjects} from './helpers/css-project'

const makeProject = cssProjects()

async function marker(root: string, file: string): Promise<unknown> {
  const config = await loadUserPostCssConfigObject(
    path.join(root, file),
    root,
    'development'
  )

  return config?.marker
}

function configSource(file: string, value: string): string {
  return file.endsWith('.mjs')
    ? `export default {plugins: [], marker: ${value}}\n`
    : `module.exports = {plugins: [], marker: ${value}}\n`
}

// Node keeps a module under the address it was imported by, so each read of
// a config has to ask under an address no earlier read used.
describe('a PostCSS config read twice in one process', () => {
  it.each([
    'postcss.config.mjs',
    'postcss.config.js',
    'postcss.config.cjs'
  ])('%s: a second save with the same file time is still read', async (file) => {
    const root = makeProject({[file]: configSource(file, "'first'")})
    const config = path.join(root, file)
    const time = new Date(Date.now() - 60000)

    fs.utimesSync(config, time, time)
    expect(await marker(root, file)).toBe('first')

    fs.writeFileSync(config, configSource(file, "'second'"))
    fs.utimesSync(config, time, time)
    expect(await marker(root, file)).toBe('second')
  })

  // A config that is CommonJS loads its helpers through require, whose
  // registry this step can clear for the files of the project.
  it.each([
    'postcss.config.js',
    'postcss.config.cjs'
  ])('%s: an edit to a file it requires, or one that file requires, is read', async (file) => {
    const root = makeProject({
      [file]: configSource(file, "require('./tokens/index.cjs')"),
      'tokens/index.cjs': "module.exports = require('./deep.cjs')\n",
      'tokens/deep.cjs': "module.exports = 'first'\n"
    })

    expect(await marker(root, file)).toBe('first')

    fs.writeFileSync(
      path.join(root, 'tokens', 'deep.cjs'),
      "module.exports = 'second'\n"
    )

    expect(await marker(root, file)).toBe('second')
  })

  it('a package the config requires stays as it was loaded', async () => {
    const root = makeProject({
      'postcss.config.cjs': configSource(
        'postcss.config.cjs',
        "require('counted')"
      ),
      'node_modules/counted/package.json': JSON.stringify({
        name: 'counted',
        main: 'index.js'
      }),
      'node_modules/counted/index.js':
        'globalThis.__countedLoads = (globalThis.__countedLoads || 0) + 1\nmodule.exports = globalThis.__countedLoads\n'
    })

    expect(await marker(root, 'postcss.config.cjs')).toBe(1)
    expect(await marker(root, 'postcss.config.cjs')).toBe(1)
  })
})

import {execFileSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {resolveDevelopDistFile} from '../../lib/develop-context'
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
  it('postcss.config.cjs: an edit to a file it requires, or one that file requires, is read', async () => {
    const file = 'postcss.config.cjs'
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

// Two builds in one process, with the file the config requires edited in
// between. Each prints the word its build stamped on the sheet.
const TWO_BUILDS = [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  "import {pathToFileURL} from 'node:url'",
  'const [engine, root] = process.argv.slice(2)',
  'const {extensionBuild} = await import(pathToFileURL(engine).href)',
  'const words = []',
  "for (const word of ['first', 'second']) {",
  "  fs.writeFileSync(path.join(root, 'tokens', 'deep.cjs'), `module.exports = '${word}'\\n`)",
  "  await extensionBuild(root, {browser: 'chrome', silent: true, install: false, mode: 'production', exitOnError: false})",
  "  const dist = path.join(root, 'dist', 'chrome')",
  "  const sheet = fs.readdirSync(dist, {recursive: true}).find((file) => String(file).endsWith('.css'))",
  "  words.push(/--stamp:\\s*(\\w+)/.exec(fs.readFileSync(path.join(dist, String(sheet)), 'utf8'))?.[1])",
  '}',
  "console.log('STAMPS ' + words.join(','))",
  'process.exit(0)',
  ''
].join('\n')

// A dev session with no browser: once it says it is ready, edits the file
// two requires down from the config and waits for the stamp to follow.
const WATCH = [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  "import {pathToFileURL} from 'node:url'",
  'const [engine, root] = process.argv.slice(2)',
  'const {extensionDev} = await import(pathToFileURL(engine).href)',
  'const stamp = () => {',
  "  const dist = path.join(root, 'dist', 'chrome')",
  '  if (!fs.existsSync(dist)) return undefined',
  '  for (const file of fs.readdirSync(dist, {recursive: true})) {',
  "    if (!String(file).endsWith('.css')) continue",
  "    const found = /--stamp:\\s*(\\w+)/.exec(fs.readFileSync(path.join(dist, String(file)), 'utf8'))?.[1]",
  '    if (found) return found',
  '  }',
  '}',
  'const until = async (word) => {',
  '  for (let turn = 0; turn < 400 && stamp() !== word; turn++) {',
  '    await new Promise((resolve) => setTimeout(resolve, 100))',
  '  }',
  '  return stamp()',
  '}',
  "extensionDev(root, {browser: 'chrome', noBrowser: true, install: false, open: false}).catch((error) => console.log('DEV ' + error?.message))",
  "const first = await until('first')",
  "const ready = path.join(root, 'dist', 'extension-js', 'chrome', 'ready.json')",
  'for (let turn = 0; turn < 400 && !fs.existsSync(ready); turn++) {',
  '  await new Promise((resolve) => setTimeout(resolve, 100))',
  '}',
  "fs.writeFileSync(path.join(root, 'tokens', 'deep.cjs'), \"module.exports = 'second'\\n\")",
  "console.log('STAMPS ' + [first, await until('second')].join(','))",
  'process.exit(0)',
  ''
].join('\n')

// The test runner loads a CommonJS postcss.config.js its own way, so these
// run the built engine in a plain Node process.
describe('a CommonJS postcss.config.js that requires a helper, in plain Node', () => {
  it.each([
    ['two builds in one process read', TWO_BUILDS],
    ['a dev session rebuilds on', WATCH]
  ])(
    '%s an edit to a file the helper requires',
    (_label, script) => {
      const engine = path.join(
        path.dirname(resolveDevelopDistFile('dead-css-url-loader')),
        'module.mjs'
      )

      if (!fs.existsSync(engine)) {
        throw new Error(
          `This spec builds with programs/develop/dist and ${engine} is missing. ` +
            'Run `pnpm --filter extension-develop compile` first.'
        )
      }

      const root = makeProject({
        'run.mjs': script,
        'app/package.json': JSON.stringify({private: true, name: 'reread'}),
        'app/manifest.json': JSON.stringify({
          manifest_version: 3,
          name: 'reread',
          version: '1.0.0',
          action: {default_popup: 'popup.html'}
        }),
        'app/popup.html':
          '<!doctype html><link rel="stylesheet" href="./styles.css"><p>x</p>\n',
        'app/styles.css': '.a{color:red}\n',
        'app/tokens/index.cjs': "module.exports = require('./deep.cjs')\n",
        'app/tokens/deep.cjs': "module.exports = 'first'\n",
        'app/postcss.config.js': [
          "const word = require('./tokens/index.cjs')",
          "module.exports = {plugins: [{postcssPlugin: 'stamp', Rule(rule) { rule.append({prop: '--stamp', value: word}) }}]}",
          ''
        ].join('\n')
      })

      const output = execFileSync(
        process.execPath,
        [path.join(root, 'run.mjs'), engine, path.join(root, 'app')],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            EXTENSION_TELEMETRY_DISABLED: '1',
            DO_NOT_TRACK: '1'
          }
        }
      )

      expect(
        output.split('\n').filter((line) => line.startsWith('STAMPS'))
      ).toEqual(['STAMPS first,second'])
    },
    120_000
  )
})

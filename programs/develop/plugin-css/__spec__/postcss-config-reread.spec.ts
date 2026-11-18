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

// The test runner loads a CommonJS postcss.config.js its own way, so this
// one runs the built engine in a plain Node process.
describe('a CommonJS postcss.config.js in a process that builds twice', () => {
  it('reads an edit to a file the config requires, or one that file requires', () => {
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
      'two-builds.mjs': TWO_BUILDS,
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
      [path.join(root, 'two-builds.mjs'), engine, path.join(root, 'app')],
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
  }, 120_000)
})

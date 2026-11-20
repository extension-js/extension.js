import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {
  writeExtensionProject,
  writeProjectFiles
} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// Every other build spec passes install: false. Here the build runs its own
// install through a stand-in manager, then bundles what the install wrote.
const tempFolder = trackTempFolders()
const DEPENDENCY = 'spec-installed-dependency'

// Writes only the two paths it is handed, and nothing when it was started
// anywhere but the project it was made for.
const STAND_IN_MANAGER = `
const fs = require('node:fs')
const path = require('node:path')
const project = process.env.SPEC_STAND_IN_PROJECT
const log = process.env.SPEC_STAND_IN_LOG

if (!project || !log) process.exit(3)

fs.appendFileSync(log, JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}) + '\\n')

if (fs.realpathSync(process.cwd()) !== fs.realpathSync(project)) process.exit(4)
if (process.env.SPEC_STAND_IN_FAILS) {
  console.error('the stand-in registry refused the install')
  process.exit(1)
}

const dependency = path.join(project, 'node_modules', ${JSON.stringify(DEPENDENCY)})

fs.mkdirSync(dependency, {recursive: true})
fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({name: ${JSON.stringify(DEPENDENCY)}, version: '1.0.0', main: 'index.js'}))
fs.writeFileSync(path.join(dependency, 'index.js'), 'module.exports = "written by the install"\\n')
`

const ENV_NAMES = [
  'EXTENSION_JS_PACKAGE_MANAGER',
  'EXTENSION_JS_PM_EXEC_PATH',
  'EXTENSION_SKIP_INSTALL',
  'SPEC_STAND_IN_PROJECT',
  'SPEC_STAND_IN_LOG',
  'SPEC_STAND_IN_FAILS',
  'npm_execpath',
  'npm_config_user_agent'
]
const before = new Map<string, string | undefined>()

function project() {
  const root = writeExtensionProject(tempFolder('extjs-build-installs-'), {
    name: 'build-installs',
    manifest: {background: {service_worker: 'background.js'}},
    packageJson: {dependencies: {[DEPENDENCY]: '1.0.0'}},
    files: {
      'background.js': `import said from '${DEPENDENCY}'\nconsole.log(said)\n`
    }
  })
  const tools = fs.realpathSync(tempFolder('extjs-build-installs-manager-'))

  writeProjectFiles(tools, {'npm-cli.cjs': STAND_IN_MANAGER})

  process.env.EXTENSION_JS_PACKAGE_MANAGER = 'npm'
  process.env.EXTENSION_JS_PM_EXEC_PATH = path.join(tools, 'npm-cli.cjs')
  process.env.SPEC_STAND_IN_PROJECT = root
  process.env.SPEC_STAND_IN_LOG = path.join(tools, 'runs.ndjson')

  return {root, log: path.join(tools, 'runs.ndjson')}
}

function runs(log: string): Array<{cwd: string; args: string[]}> {
  if (!fs.existsSync(log)) return []

  return fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function bundled(root: string): string {
  const dist = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
  )

  return fs.readFileSync(
    path.join(dist, manifest.background.service_worker),
    'utf8'
  )
}

beforeEach(() => {
  for (const name of ENV_NAMES) {
    before.set(name, process.env[name])
    Reflect.deleteProperty(process.env, name)
  }

  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()

  for (const [name, value] of before) {
    if (value === undefined) Reflect.deleteProperty(process.env, name)
    else process.env[name] = value
  }
})

describe('a build of a project whose dependencies are not installed', () => {
  it('installs them in the project, without lifecycle scripts, and bundles the result', async () => {
    const {root, log} = project()

    const summary = await buildProject(root, {install: undefined})

    expect(runs(log)).toEqual([
      {cwd: root, args: ['install', '--ignore-scripts']}
    ])

    expect(summary.errors_count).toBe(0)
    expect(bundled(root)).toContain('written by the install')
  })

  it('installs nothing the second time, when the dependency is in place', async () => {
    const {root, log} = project()

    await buildProject(root, {install: undefined})
    await buildProject(root, {install: undefined})

    expect(runs(log)).toHaveLength(1)
  })

  it.each([
    ['install: false', {install: false}, undefined],
    ['EXTENSION_SKIP_INSTALL=1', {install: undefined}, '1']
  ])('runs no install under %s and fails on the import it cannot resolve', async (_label, options, skip) => {
    const {root, log} = project()

    if (skip) process.env.EXTENSION_SKIP_INSTALL = skip

    await expect(buildProject(root, options)).rejects.toMatchObject({
      code: 'E_COMPILE',
      diagnostics: [
        {
          code: 'E_MODULE_NOT_FOUND',
          file: 'background.js',
          message: expect.stringContaining(DEPENDENCY)
        }
      ]
    })

    expect(runs(log)).toEqual([])
    expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false)
  })

  it('stops with the install code when the manager fails, and builds nothing', async () => {
    const {root, log} = project()
    const said: string[] = []

    process.env.SPEC_STAND_IN_FAILS = '1'
    // The manager's own words go to stderr as it prints them.
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      said.push(String(chunk))

      return true
    }) as typeof process.stderr.write)

    await expect(
      buildProject(root, {install: undefined})
    ).rejects.toMatchObject({code: 'E_DEPENDENCY_INSTALL'})

    expect(runs(log)).toHaveLength(1)
    expect(said.join('')).toContain('the stand-in registry refused the install')
    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
  })
})

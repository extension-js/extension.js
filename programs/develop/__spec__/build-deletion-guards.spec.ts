import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from './helpers/temp-folders'

// A build replaces its output folder whole, so the folder is checked before
// anything is deleted. Every case here keeps a file the old build removed.
const tempFolder = trackTempFolders()
const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// The message without its colors and without the channel glyph at its head.
const plain = (text: unknown) =>
  String(text)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^\S+ /, '')

// The project sits one level down, so the folder above it is ours to fill.
function project(config?: string) {
  const parent = fs.realpathSync(tempFolder('extjs-guard-'))
  const root = path.join(parent, 'project')
  fs.mkdirSync(root)

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'guard', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'guard',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    })
  )

  fs.writeFileSync(path.join(root, 'background.js'), 'console.log(1)\n')

  if (config) fs.writeFileSync(path.join(root, 'extension.config.js'), config)

  return {parent, root}
}

async function build(root: string, options: Record<string, unknown> = {}) {
  const {extensionBuild} = await import('../command-build')

  vi.spyOn(console, 'error').mockImplementation(() => {})

  let summary: Awaited<ReturnType<typeof extensionBuild>> | undefined
  let failure: (Error & {code?: string}) | undefined

  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      ...options
    } as never)
  } catch (error) {
    failure = error as Error & {code?: string}
  }

  return {summary, failure}
}

const repoint = (target: string) =>
  `module.exports = {config: (c) => ({...c, output: {...c.output, path: ${JSON.stringify(target)}}})}\n`

const OUTPUT_PATH_FIX =
  'The build empties its output folder before it writes, so nothing was built and nothing was deleted. Point output.path at a folder of its own such as build.'

const OUT_DIR_FIX =
  'The build replaces <out-dir>/<browser>, so nothing was deleted. Pass a folder of its own such as --out-dir build.'

describe('a re-pointed output.path the build must not empty', () => {
  it('refuses the project root and keeps every project file', async () => {
    const {root} = project(repoint('.'))
    const {failure} = await build(root)

    expect(failure?.code).toBe('E_INVALID_OPTION')
    expect(plain(failure?.message)).toBe(
      `output.path in the extension config resolves to ${root}, the project root or a folder above it.\n${OUTPUT_PATH_FIX}`
    )

    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'background.js'))).toBe(true)
  }, 120_000)

  it('refuses a folder above the project and keeps what sits beside it', async () => {
    const {parent, root} = project(repoint('..'))
    fs.writeFileSync(path.join(parent, 'SENTINEL.txt'), 'PRECIOUS')

    const {failure} = await build(root)

    expect(failure?.code).toBe('E_INVALID_OPTION')
    expect(plain(failure?.message)).toBe(
      `output.path in the extension config resolves to ${parent}, the project root or a folder above it.\n${OUTPUT_PATH_FIX}`
    )

    expect(fs.readFileSync(path.join(parent, 'SENTINEL.txt'), 'utf8')).toBe(
      'PRECIOUS'
    )

    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true)
  }, 120_000)

  it('refuses the current folder when the build runs from elsewhere', async () => {
    const elsewhere = fs.realpathSync(tempFolder('extjs-guard-cwd-'))
    fs.writeFileSync(path.join(elsewhere, 'SENTINEL.txt'), 'PRECIOUS')

    const {root} = project(repoint(elsewhere))
    process.chdir(elsewhere)

    const {failure} = await build(root)

    expect(failure?.code).toBe('E_INVALID_OPTION')
    expect(plain(failure?.message)).toBe(
      `output.path in the extension config resolves to ${elsewhere}, the current folder or a folder above it.\n${OUTPUT_PATH_FIX}`
    )

    expect(fs.readFileSync(path.join(elsewhere, 'SENTINEL.txt'), 'utf8')).toBe(
      'PRECIOUS'
    )
  }, 120_000)

  it('refuses the session state folder and keeps a managed profile', async () => {
    const {root} = project(repoint('dist/extension-js'))
    const profile = path.join(
      root,
      'dist',
      'extension-js',
      'profiles',
      'Cookies'
    )
    fs.mkdirSync(path.dirname(profile), {recursive: true})
    fs.writeFileSync(profile, 'PRECIOUS')

    const {failure} = await build(root)

    expect(failure?.code).toBe('E_INVALID_OPTION')
    expect(plain(failure?.message)).toBe(
      `output.path in the extension config resolves to ${path.join(root, 'dist', 'extension-js')}, where Extension.js keeps session state and browser profiles.\n${OUTPUT_PATH_FIX}`
    )

    expect(fs.readFileSync(profile, 'utf8')).toBe('PRECIOUS')
  }, 120_000)

  it('still empties a folder of its own before it writes', async () => {
    const {root} = project(repoint('build'))
    fs.mkdirSync(path.join(root, 'build'))
    fs.writeFileSync(path.join(root, 'build', 'stale.js'), 'old')

    const {summary, failure} = await build(root)

    expect(failure).toBeUndefined()
    expect(summary?.output_path).toBe(path.join(root, 'build'))
    expect(fs.existsSync(path.join(root, 'build', 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'build', 'stale.js'))).toBe(false)
  }, 120_000)
})

describe('an --out-dir the build must not replace', () => {
  it('refuses a folder above the project', async () => {
    const {parent, root} = project()
    const precious = path.join(parent, 'chrome', 'SENTINEL.txt')
    fs.mkdirSync(path.dirname(precious))
    fs.writeFileSync(precious, 'PRECIOUS')

    const {failure} = await build(root, {outDir: '..'})

    expect(failure?.code).toBe('E_INVALID_OPTION')
    expect(plain(failure?.message)).toBe(
      `--out-dir got .., which resolves to ${parent}, the project root or a folder above it.\n${OUT_DIR_FIX}`
    )

    expect(fs.readFileSync(precious, 'utf8')).toBe('PRECIOUS')
  }, 120_000)

  it('refuses the home folder', async () => {
    const home = fs.realpathSync(tempFolder('extjs-guard-home-'))
    const precious = path.join(home, 'chrome', 'SENTINEL.txt')
    fs.mkdirSync(path.dirname(precious))
    fs.writeFileSync(precious, 'PRECIOUS')
    vi.stubEnv('HOME', home)
    vi.stubEnv('USERPROFILE', home)
    expect(os.homedir()).toBe(home)

    const {root} = project()
    const {failure} = await build(root, {outDir: home})

    expect(failure?.code).toBe('E_INVALID_OPTION')
    expect(plain(failure?.message)).toBe(
      `--out-dir got ${home}, which resolves to ${home}, the home folder or a folder above it.\n${OUT_DIR_FIX}`
    )

    expect(fs.readFileSync(precious, 'utf8')).toBe('PRECIOUS')
  }, 120_000)

  it('refuses the session state folder and keeps the ready contract', async () => {
    const {root} = project()
    const contract = path.join(
      root,
      'dist',
      'extension-js',
      'chrome',
      'ready.json'
    )
    fs.mkdirSync(path.dirname(contract), {recursive: true})
    fs.writeFileSync(contract, '{"status":"ready"}')

    const {failure} = await build(root, {outDir: 'dist/extension-js'})

    expect(failure?.code).toBe('E_INVALID_OPTION')
    expect(plain(failure?.message)).toBe(
      `--out-dir got dist/extension-js, which resolves to ${path.join(root, 'dist', 'extension-js')}, where Extension.js keeps session state and browser profiles.\n${OUT_DIR_FIX}`
    )

    expect(fs.readFileSync(contract, 'utf8')).toBe('{"status":"ready"}')
  }, 120_000)

  it('refuses a folder outside the project that no build wrote', async () => {
    const {parent, root} = project()
    const target = path.join(parent, 'shared', 'chrome')
    fs.mkdirSync(target, {recursive: true})
    fs.writeFileSync(path.join(target, 'SENTINEL.txt'), 'PRECIOUS')

    const {failure} = await build(root, {outDir: '../shared'})

    expect(failure?.code).toBe('E_INVALID_OPTION')
    expect(plain(failure?.message)).toBe(
      `--out-dir got ../shared, and ${target} is outside the project and holds files no extension build wrote.\n` +
        'The build replaces that folder, so nothing was deleted. Pass a folder that does not exist yet, or one a previous build wrote, which holds manifest.json.'
    )

    expect(fs.readFileSync(path.join(target, 'SENTINEL.txt'), 'utf8')).toBe(
      'PRECIOUS'
    )
  }, 120_000)

  it('writes a folder outside the project that is absent, then replaces its own build', async () => {
    const {parent, root} = project()
    const target = path.join(parent, 'shared', 'chrome')

    const first = await build(root, {outDir: '../shared'})

    expect(first.failure).toBeUndefined()
    expect(fs.existsSync(path.join(target, 'manifest.json'))).toBe(true)

    fs.writeFileSync(path.join(target, 'stale.js'), 'old')

    const second = await build(root, {outDir: '../shared'})

    expect(second.failure).toBeUndefined()
    expect(fs.existsSync(path.join(target, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'stale.js'))).toBe(false)
  }, 120_000)
})

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'
import {buildProject} from './helpers/build-project'
import {workspacePackage} from './helpers/workspace-package'

const PROJECT_VERSION = '5.999.0'
const PROJECT_STAMP = 'PROJECT SVELTE RUNTIME COPY'

// svelte-loader is not in the fixture, so it resolves from Extension.js and
// compiles with the svelte beside it.
const fromDevelop = createRequire(path.join(__dirname, '..', 'x.js'))
const hasSvelte = Boolean(
  workspacePackage('svelte') && workspacePackage('svelte-loader')
)

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function compilerSvelte() {
  const fromLoader = createRequire(fromDevelop.resolve('svelte-loader'))
  const packageJson = fromLoader.resolve('svelte/package.json')

  return {
    dir: fs.realpathSync(path.dirname(packageJson)),
    version: JSON.parse(fs.readFileSync(packageJson, 'utf8')).version as string
  }
}

// A real runtime under a newer version number, stamped so the bundle shows
// which copy it linked. Its own dependencies are linked beside it.
function installNewerSvelte(root: string, compilerDir: string) {
  const modules = path.join(root, 'node_modules')
  const copy = path.join(modules, 'svelte')

  fs.cpSync(compilerDir, copy, {
    recursive: true,
    dereference: true,
    filter: (source) => path.basename(source) !== 'node_modules'
  })

  const packageJsonPath = path.join(copy, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  packageJson.version = PROJECT_VERSION
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson))
  fs.appendFileSync(
    path.join(copy, 'src', 'index-client.js'),
    `\nconsole.log(${JSON.stringify(PROJECT_STAMP)})\n`
  )

  const fromCompiler = createRequire(path.join(compilerDir, 'package.json'))

  for (const name of Object.keys(packageJson.dependencies || {})) {
    const found = (fromCompiler.resolve.paths(name) || [])
      .map((dir) => path.join(dir, name))
      .find((dir) => fs.existsSync(path.join(dir, 'package.json')))

    if (!found) continue

    const link = path.join(modules, name)
    fs.mkdirSync(path.dirname(link), {recursive: true})
    fs.symlinkSync(fs.realpathSync(found), link, 'dir')
  }
}

function project(compilerDir: string) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'extjs-svelte-newer-')
  )
  roots.push(root)
  installNewerSvelte(root, compilerDir)

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'svelte-newer-runtime',
      version: '0.0.0',
      dependencies: {svelte: PROJECT_VERSION}
    })
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Svelte newer runtime',
      version: '1.0.0',
      chrome_url_overrides: {newtab: 'newtab.html'}
    })
  )

  write(
    root,
    'newtab.html',
    '<!doctype html><title>NEWTAB</title><div id="app"></div><script type="module" src="./newtab.js"></script>'
  )

  write(
    root,
    'newtab.js',
    "import {mount} from 'svelte'\nimport App from './App.svelte'\nmount(App, {target: document.getElementById('app')})\n"
  )

  write(root, 'App.svelte', '<h1>MOUNTED BY SVELTE</h1>\n')

  return root
}

function emittedScripts(root: string) {
  const distDir = path.join(root, 'dist', 'chrome')

  return fs
    .readdirSync(distDir, {recursive: true})
    .map(String)
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => fs.readFileSync(path.join(distDir, entry), 'utf8'))
    .join('\n')
}

describe.skipIf(!hasSvelte)('a project svelte newer than the compiler', () => {
  it.each([
    'development',
    'production'
  ] as const)('links the runtime of the svelte that compiled in %s', async (mode) => {
    const compiler = compilerSvelte()
    const root = project(compiler.dir)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const summary = await buildProject(root, {mode})
    const emitted = emittedScripts(root)

    expect(summary.errors_count).toBe(0)
    // Output from one release mounts nothing on the runtime of another, so
    // the page runs on the copy that compiled it and the session says so.
    expect(emitted.includes(PROJECT_STAMP)).toBe(false)
    expect(emitted.includes('MOUNTED BY SVELTE')).toBe(true)
    expect(summary.warnings).toEqual([
      expect.stringContaining(
        `W_MANAGED_DEP_CONFLICT: Svelte ${compiler.version} compiles this project, which installs svelte ${PROJECT_VERSION}.`
      )
    ])

    expect(warn).toHaveBeenCalledTimes(1)
  }, 180_000)

  it('runs the DOM setup the mount depends on in a dev page', async () => {
    const root = project(compilerSvelte().dir)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await buildProject(root, {mode: 'development'})

    // Defined is not enough: a page whose bundle never calls it throws on the
    // first template and leaves the mount container empty.
    expect(
      /(?<!function )init_operations\)?\(\)/.test(emittedScripts(root))
    ).toBe(true)
  }, 180_000)
})

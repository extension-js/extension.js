import {spawnSync} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (existsSync(cjs)) return cjs

  return path.join(cliRoot(), 'dist', 'cli.js')
}

const developRoot = path.resolve(cliRoot(), '..', 'develop')
const developRequire = createRequire(path.join(developRoot, 'package.json'))

// sass does not export its package.json, so the package dir is the nearest
// ancestor of the resolved entry that carries a package.json with its name.
function packageDirOf(entryFile: string, name: string): string {
  let dir = path.dirname(entryFile)

  for (;;) {
    const manifest = path.join(dir, 'package.json')

    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (pkg.name === name) return dir
    }

    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`no ${name} package above ${entryFile}`)

    dir = parent
  }
}

// The compiler the project declares is linked in from the install the CLI
// already has, so the build never reaches for the network. The loader is NOT
// linked: the CLI must find its own copy from wherever the project sits.
// The compiler is a peer of its loader, so it resolves from the loader's
// own dir under every linker (hoisted and isolated alike).
function linkCompiler(projectDir: string, name: 'sass' | 'less') {
  const loaderEntry = developRequire.resolve(`${name}-loader`)
  const compilerDir = packageDirOf(
    createRequire(loaderEntry).resolve(name),
    name
  )
  const nodeModules = path.join(projectDir, 'node_modules')
  mkdirSync(nodeModules, {recursive: true})
  symlinkSync(
    compilerDir,
    path.join(nodeModules, name),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
}

type Fixture = {
  compiler: 'sass' | 'less'
  sheetName: string
  sheet: string
}

const created: string[] = []

function createFixture(fixture: Fixture): string {
  const projectDir = realpathSync(
    mkdtempSync(path.join(tmpdir(), `extjs-outside-${fixture.compiler}-`))
  )
  created.push(projectDir)

  writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({
      name: `outside-${fixture.compiler}-fixture`,
      private: true,
      version: '0.0.1',
      devDependencies: {[fixture.compiler]: '*'}
    }),
    'utf8'
  )

  writeFileSync(
    path.join(projectDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: `Outside ${fixture.compiler} fixture`,
      version: '0.0.1',
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    }),
    'utf8'
  )

  writeFileSync(
    path.join(projectDir, 'content.js'),
    [
      `import './${fixture.sheetName}'`,
      "const badge = document.createElement('div')",
      "badge.className = 'badge'",
      'document.body.appendChild(badge)'
    ].join('\n'),
    'utf8'
  )

  writeFileSync(path.join(projectDir, fixture.sheetName), fixture.sheet, 'utf8')
  linkCompiler(projectDir, fixture.compiler)

  return projectDir
}

function build(projectDir: string) {
  return spawnSync(
    process.execPath,
    [cliBin(), 'build', projectDir, '--browser=chrome'],
    {
      // The project dir, not the repo: nothing in the walk up from here
      // reaches the checkout's node_modules.
      cwd: projectDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        EXTENSION_ENV: 'test',
        EXTENSION_TELEMETRY_DISABLED: '1'
      }
    }
  )
}

function readEmittedContentScript(projectDir: string): string {
  const dir = path.join(projectDir, 'dist', 'chrome', 'content_scripts')
  const file = readdirSync(dir).find(
    (name) => /^content-0.*\.js$/.test(name) && !name.endsWith('.map')
  )
  if (!file) throw new Error(`no emitted content-0 bundle in ${dir}`)

  return readFileSync(path.join(dir, file), 'utf8')
}

afterAll(() => {
  for (const dir of created) {
    rmSync(dir, {recursive: true, force: true})
  }
})

// A checkout whose package manager hoists extension-develop's loaders above
// the package (pnpm node-linker=hoisted does) used to fail every Sass and Less
// project that lives outside the repo with "Unable to resolve loader
// sass-loader", while the same project built fine inside the tree.
describe('preprocessor loaders for a project outside the repo', () => {
  it('compiles a Sass content script from a temp dir with the CLI alone', () => {
    const projectDir = createFixture({
      compiler: 'sass',
      sheetName: 'styles.scss',
      sheet: [
        '$badge: #123456;',
        '.badge {',
        '  color: $badge;',
        '  .inner { color: red; }',
        '}'
      ].join('\n')
    })

    const result = build(projectDir)
    const output = `${result.stdout}\n${result.stderr}`

    expect(output).not.toContain('Unable to resolve loader')
    expect(result.status, `build failed:\n${output}`).toBe(0)

    const bundle = readEmittedContentScript(projectDir)
    // Nesting flattened and the variable substituted: sass-loader really ran.
    expect(bundle).toContain('.badge .inner')
    expect(bundle).toContain('#123456')
    expect(bundle).not.toContain('$badge')
  }, 120000)

  it('compiles a Less content script from a temp dir with the CLI alone', () => {
    const projectDir = createFixture({
      compiler: 'less',
      sheetName: 'styles.less',
      sheet: [
        '@badge: #123456;',
        '.badge {',
        '  color: @badge;',
        '  .inner { color: red; }',
        '}'
      ].join('\n')
    })

    const result = build(projectDir)
    const output = `${result.stdout}\n${result.stderr}`

    expect(output).not.toContain('Unable to resolve loader')
    expect(result.status, `build failed:\n${output}`).toBe(0)

    const bundle = readEmittedContentScript(projectDir)
    expect(bundle).toContain('.badge .inner')
    expect(bundle).toContain('#123456')
    expect(bundle).not.toContain('@badge')
  }, 120000)
})

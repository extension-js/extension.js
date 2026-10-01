import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const WORKSPACE_MODULES = path.resolve(__dirname, '../../../node_modules')
const hasSvelte =
  fs.existsSync(path.join(WORKSPACE_MODULES, 'svelte', 'package.json')) &&
  fs.existsSync(path.join(WORKSPACE_MODULES, 'svelte-loader', 'package.json'))

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function linkSvelte(root: string) {
  fs.mkdirSync(path.join(root, 'node_modules'), {recursive: true})

  for (const name of ['svelte', 'svelte-loader']) {
    fs.symlinkSync(
      path.join(WORKSPACE_MODULES, name),
      path.join(root, 'node_modules', name),
      'dir'
    )
  }

  return JSON.parse(
    fs.readFileSync(
      path.join(WORKSPACE_MODULES, 'svelte', 'package.json'),
      'utf8'
    )
  ).version as string
}

function project() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'extjs-svelte-rune-')
  )
  roots.push(root)
  const version = linkSvelte(root)

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'svelte-rune-module',
      version: '0.0.0',
      dependencies: {svelte: version},
      devDependencies: {typescript: '5.4.5'}
    })
  )

  write(
    root,
    'tsconfig.json',
    JSON.stringify({compilerOptions: {strict: true, target: 'ESNext'}})
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Svelte rune module',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )

  write(
    root,
    'popup.html',
    '<!doctype html><title>POPUP</title><div id="root"></div><script type="module" src="./popup.ts"></script>'
  )

  write(
    root,
    'popup.ts',
    "import {mount} from 'svelte'\nimport App from './App.svelte'\nmount(App, {target: document.getElementById('root') as HTMLElement})\n"
  )

  write(
    root,
    'App.svelte',
    '<script lang="ts">\n' +
      "import {createTypedCounter} from './typed-counter.svelte'\n" +
      "import {createPlainCounter} from './plain-counter.svelte.js'\n" +
      'const typed = createTypedCounter(1)\n' +
      'const plain = createPlainCounter(1)\n' +
      '</script>\n' +
      '<button onclick={() => typed.bump()}>{typed.typedCount}</button>\n' +
      '<button onclick={() => plain.bump()}>{plain.plainCount}</button>\n'
  )

  write(
    root,
    'typed-counter.svelte.ts',
    'interface CounterStart {start: number}\n' +
      'export function createTypedCounter(start: number) {\n' +
      '  const initial: CounterStart = {start}\n' +
      '  let typedCount = $state(initial.start)\n' +
      '  return {\n' +
      '    get typedCount() {\n' +
      '      return typedCount\n' +
      '    },\n' +
      '    bump() {\n' +
      '      typedCount += 1\n' +
      '    }\n' +
      '  }\n' +
      '}\n'
  )

  write(
    root,
    'plain-counter.svelte.js',
    'export function createPlainCounter(start) {\n' +
      '  let plainCount = $state(start)\n' +
      '  return {\n' +
      '    get plainCount() {\n' +
      '      return plainCount\n' +
      '    },\n' +
      '    bump() {\n' +
      '      plainCount += 1\n' +
      '    }\n' +
      '  }\n' +
      '}\n'
  )

  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  let summary: {errors_count: number}

  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } catch (error) {
    throw new Error(`build failed: ${String(error)}\n${lines.join('\n')}`)
  } finally {
    console.log = originalLog
    console.error = originalError
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  if (summary.errors_count > 0) {
    throw new Error(`build failed:\n${lines.join('\n')}`)
  }

  const distDir = path.join(root, 'dist', 'chrome')

  return fs
    .readdirSync(distDir, {recursive: true})
    .map(String)
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => fs.readFileSync(path.join(distDir, entry), 'utf8'))
    .join('\n')
}

const devTag = (name: string) =>
  new RegExp(`\\.tag\\([^\\n]*['"]${name}['"]\\)`)

describe.skipIf(!hasSvelte)('Svelte rune modules', () => {
  it('compiles a TypeScript rune module in dev like its JavaScript twin', async () => {
    const emitted = await build(project(), 'development')

    expect(emitted).toContain('createTypedCounter')
    expect(emitted).not.toContain('createTypedCounter(start: number)')
    expect(emitted).not.toContain('initial: CounterStart')
    expect(emitted).not.toContain('interface CounterStart')
    expect(emitted).toMatch(devTag('typedCount'))
    expect(emitted).toMatch(devTag('plainCount'))
  }, 180_000)

  it('compiles a TypeScript rune module for production without dev tags', async () => {
    const emitted = await build(project(), 'production')

    expect(emitted).not.toContain('interface CounterStart')
    expect(emitted).not.toMatch(devTag('typedCount'))
    expect(emitted).not.toMatch(devTag('plainCount'))
  }, 180_000)
})

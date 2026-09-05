import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// Every framework's pages must parse, ship a bundle the page can run no
// matter how the entry is written, and pull the JSX runtime of the framework
// the project installed. Content scripts keep classic script handling.
// The runtimes below are stand-ins that mark which package the bundle pulled.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function runtimeStub(name: string) {
  return (
    `export const Fragment = 'Fragment'\n` +
    `export function jsx(type, props) { globalThis.__jsxRuntime = '${name}'; return {type, props} }\n` +
    `export const jsxs = jsx\n` +
    `export function jsxDEV(type, props) { return jsx(type, props) }\n`
  )
}

function stubPackage(
  root: string,
  name: string,
  version: string,
  files: Record<string, string>,
  exportsMap: Record<string, string>
) {
  const dir = path.join(root, 'node_modules', name)
  write(
    root,
    path.join('node_modules', name, 'package.json'),
    JSON.stringify({
      name,
      version,
      type: 'module',
      main: './index.js',
      exports: {...exportsMap, './package.json': './package.json'}
    })
  )
  for (const [rel, content] of Object.entries(files)) {
    write(root, path.relative(root, path.join(dir, rel)), content)
  }
}

type Framework = 'react' | 'preact' | 'vue' | 'solid'

function installFramework(root: string, framework: Framework) {
  if (framework === 'react') {
    stubPackage(
      root,
      'react',
      '18.3.1',
      {
        'index.js': 'export function createElement() {}\n',
        'jsx-runtime.js': runtimeStub('react'),
        'jsx-dev-runtime.js': runtimeStub('react')
      },
      {
        '.': './index.js',
        './jsx-runtime': './jsx-runtime.js',
        './jsx-dev-runtime': './jsx-dev-runtime.js'
      }
    )
    return {react: '18.3.1'}
  }
  if (framework === 'preact') {
    stubPackage(
      root,
      'preact',
      '10.27.3',
      {
        'index.js': 'export function h() {}\n',
        'jsx-runtime.js': runtimeStub('preact'),
        'jsx-dev-runtime.js': runtimeStub('preact'),
        'compat.js': 'export default {}\n',
        'hooks.js': 'export function useState() {}\n'
      },
      {
        '.': './index.js',
        './jsx-runtime': './jsx-runtime.js',
        './jsx-dev-runtime': './jsx-dev-runtime.js',
        './compat': './compat.js',
        './hooks': './hooks.js'
      }
    )
    return {preact: '10.27.3'}
  }
  if (framework === 'vue') {
    stubPackage(
      root,
      'vue',
      '3.5.26',
      {
        'index.js': 'export function ref(v) { return {value: v} }\n',
        'jsx-runtime.js': runtimeStub('vue'),
        'jsx-dev-runtime.js': runtimeStub('vue')
      },
      {
        '.': './index.js',
        './jsx-runtime': './jsx-runtime.js',
        './jsx-dev-runtime': './jsx-dev-runtime.js'
      }
    )
    return {vue: '3.5.26'}
  }
  // solid-js ships its JSX types only; runtime JSX goes through solid-js/h.
  stubPackage(
    root,
    'solid-js',
    '1.9.7',
    {
      'index.js': 'export function createSignal(v) { return [() => v] }\n',
      'h.js':
        "export default function h(type, props) { globalThis.__jsxRuntime = 'solid'; return {type, props} }\n",
      'web.js': 'export function render() {}\n'
    },
    {
      '.': './index.js',
      './h': './h.js',
      './web': './web.js'
    }
  )
  return {'solid-js': '1.9.7'}
}

function project(
  framework: Framework,
  entries: Record<string, string>,
  options: {tsconfig?: boolean; module?: boolean} = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-jsx-pages-'))
  roots.push(root)
  const dependencies = installFramework(root, framework)
  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: `${framework}-pages`,
      version: '0.0.0',
      dependencies
    })
  )
  if (options.tsconfig) {
    write(
      root,
      'tsconfig.json',
      JSON.stringify({compilerOptions: {jsx: 'preserve', strict: false}})
    )
  }
  const [entryName] = Object.keys(entries)
  const scriptTag =
    options.module === false
      ? `<script src="./${entryName}"></script>`
      : `<script type="module" src="./${entryName}"></script>`
  write(
    root,
    'pages/popup.html',
    `<!doctype html><title>POPUP</title><div id="root"></div>${scriptTag}`
  )
  for (const [name, content] of Object.entries(entries)) {
    write(root, path.join('pages', name), content)
  }
  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'JSX pages',
      version: '1.0.0',
      action: {default_popup: 'pages/popup.html'}
    })
  )
  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalError = console.error
  const originalLog = console.log
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  const originalStderr = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  let summary: {errors_count: number}
  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } catch (error) {
    throw new Error(`build failed: ${String(error)}\n${lines.join('\n')}`)
  } finally {
    process.stderr.write = originalStderr
    console.error = originalError
    console.log = originalLog
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  const distDir = path.join(root, 'dist', 'chrome')
  const output = lines.join('\n')
  const errors = summary.errors_count
  if (errors > 0) throw new Error(`build failed:\n${output}`)
  const pageBundle = () => {
    const html = fs.readFileSync(
      path.join(distDir, 'action/index.html'),
      'utf8'
    )
    const src = /<script[^>]+src="([^"]+)"/.exec(html)?.[1] || ''
    return fs.readFileSync(path.join(distDir, src.replace(/^\//, '')), 'utf8')
  }
  return {distDir, errors, output, pageBundle}
}

const RENDER_ONLY = 'document.getElementById("root").append(<p>hi</p>)\n'
const WITH_IMPORT = (pkg: string, named: string) =>
  `import {${named}} from '${pkg}'\n${named}\n${RENDER_ONLY}`

describe('JSX pages across frameworks', () => {
  it('react: a render-only module entry ships a runnable bundle, like one with imports', async () => {
    const bare = await build(project('react', {'popup.jsx': RENDER_ONLY}))
    expect(bare.errors).toBe(0)
    expect(bare.pageBundle()).not.toMatch(/\brequire\(/)
    expect(bare.pageBundle()).toMatch(/__jsxRuntime=["']react["']/)

    const imported = await build(
      project('react', {'popup.jsx': WITH_IMPORT('react', 'createElement')})
    )
    expect(imported.errors).toBe(0)
    expect(imported.pageBundle()).not.toMatch(/\brequire\(/)
    expect(imported.pageBundle()).toMatch(/__jsxRuntime=["']react["']/)
  }, 120_000)

  it('react: a classic script tag page also runs', async () => {
    const built = await build(
      project('react', {'popup.jsx': RENDER_ONLY}, {module: false})
    )
    expect(built.errors).toBe(0)
    expect(built.pageBundle()).not.toMatch(/\brequire\(/)
    expect(built.pageBundle()).toMatch(/__jsxRuntime=["']react["']/)
  }, 120_000)

  it('preact: keeps bundling preact for render-only and import entries', async () => {
    const bare = await build(project('preact', {'popup.jsx': RENDER_ONLY}))
    expect(bare.errors).toBe(0)
    expect(bare.pageBundle()).not.toMatch(/\brequire\(/)
    expect(bare.pageBundle()).toMatch(/__jsxRuntime=["']preact["']/)

    const imported = await build(
      project('preact', {'popup.jsx': WITH_IMPORT('preact', 'h')})
    )
    expect(imported.errors).toBe(0)
    expect(imported.pageBundle()).toMatch(/__jsxRuntime=["']preact["']/)
  }, 120_000)

  it('vue: a tsx page builds against vue/jsx-runtime with or without a tsconfig', async () => {
    const bare = await build(project('vue', {'popup.tsx': RENDER_ONLY}))
    expect(bare.errors).toBe(0)
    expect(bare.pageBundle()).not.toMatch(/\brequire\(/)
    expect(bare.pageBundle()).toMatch(/__jsxRuntime=["']vue["']/)

    const asModule = await build(
      project('vue', {'popup.tsx': WITH_IMPORT('vue', 'ref')}, {tsconfig: true})
    )
    expect(asModule.errors).toBe(0)
    expect(asModule.output).not.toMatch(/react\/jsx-runtime/)
    expect(asModule.pageBundle()).toMatch(/__jsxRuntime=["']vue["']/)
  }, 120_000)

  it('solid: a jsx page parses and renders through solid-js/h', async () => {
    const built = await build(project('solid', {'popup.jsx': RENDER_ONLY}))
    expect(built.errors).toBe(0)
    expect(built.output).not.toMatch(/Syntax Error/i)
    expect(built.pageBundle()).not.toMatch(/\brequire\(/)
    expect(built.pageBundle()).toMatch(/__jsxRuntime=["']solid["']/)
  }, 120_000)
})

describe('content scripts keep classic handling', () => {
  it('a classic content script with octal escapes still builds in a react project', async () => {
    const root = project('react', {'popup.jsx': RENDER_ONLY})
    write(root, 'content.js', "var s = '\\101'\nthis.marker = s\n")
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')
    )
    manifest.content_scripts = [{matches: ['<all_urls>'], js: ['content.js']}]
    write(root, 'manifest.json', JSON.stringify(manifest))
    const built = await build(root)
    expect(built.errors).toBe(0)
    const content = fs.readFileSync(
      path.join(built.distDir, 'content_scripts', 'content-0.js'),
      'utf8'
    )
    expect(content).toContain('marker')
  }, 120_000)
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {workspacePackage} from './helpers/workspace-package'

const SVELTE_PACKAGES = {
  svelte: workspacePackage('svelte'),
  'svelte-loader': workspacePackage('svelte-loader')
}
const hasSvelte = Object.values(SVELTE_PACKAGES).every(Boolean)

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

  for (const [name, dir] of Object.entries(SVELTE_PACKAGES)) {
    fs.symlinkSync(dir as string, path.join(root, 'node_modules', name), 'dir')
  }

  return JSON.parse(
    fs.readFileSync(
      path.join(SVELTE_PACKAGES.svelte as string, 'package.json'),
      'utf8'
    )
  ).version as string
}

const LANES = [
  ['content/isolated.js', 'Isolated', 'rgb(11, 12, 13)'],
  ['content/main.js', 'Main', 'rgb(21, 22, 23)'],
  ['scripts/injected.js', 'Injected', 'rgb(31, 32, 33)']
]

// A content script's stylesheet is a JavaScript module. svelte-loader's
// block reached that rule as a data URL no importer read, so it never applied.
function project(options: {sideEffectsFree: boolean}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'extjs-svelte-styles-')
  )
  roots.push(root)
  const version = linkSvelte(root)

  // The block is imported for its effect alone, which this flag would drop.
  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'svelte-content-styles',
      version: '0.0.0',
      ...(options.sideEffectsFree ? {sideEffects: false} : {}),
      dependencies: {svelte: version}
    })
  )

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Svelte content styles',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      content_scripts: [
        {matches: ['https://example.com/*'], js: ['content/isolated.js']},
        {
          matches: ['https://example.com/*'],
          js: ['content/main.js'],
          world: 'MAIN'
        }
      ]
    })
  )

  const component = (name: string, color: string) =>
    `<p class="probe_${name}">styled</p>\n` +
    `<style>\n  .probe_${name} { color: ${color}; }\n</style>\n`

  for (const [entry, name, color] of LANES) {
    write(
      root,
      entry,
      `import {mount} from 'svelte'\nimport Widget from '../src/${name}.svelte'\n` +
        "mount(Widget, {target: document.body.appendChild(document.createElement('div'))})\n"
    )

    write(root, `src/${name}.svelte`, component(name, color))
  }

  write(
    root,
    'popup.html',
    '<!doctype html><title>POPUP</title><div id="root"></div><script type="module" src="./popup.js"></script>'
  )

  write(
    root,
    'popup.js',
    "import {mount} from 'svelte'\nimport Page from './src/Page.svelte'\n" +
      "mount(Page, {target: document.getElementById('root')})\n"
  )

  write(root, 'src/Page.svelte', component('Page', 'rgb(41, 42, 43)'))

  return root
}

async function build(root: string) {
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
      mode: 'production',
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
  const read = (file: string) =>
    fs.readFileSync(path.join(distDir, file), 'utf8')
  const css = fs
    .readdirSync(distDir, {recursive: true})
    .map(String)
    .filter((entry) => entry.endsWith('.css'))
    .map(read)
    .join('\n')

  return {read, css}
}

describe.skipIf(!hasSvelte)('Svelte style blocks', () => {
  it("adds a content script component's block to the document", async () => {
    const built = await build(project({sideEffectsFree: true}))

    const emitted = [
      ['content_scripts/content-0.js', 'Isolated', 'rgb(11, 12, 13)'],
      ['content_scripts/content-1.js', 'Main', 'rgb(21, 22, 23)'],
      ['scripts/injected.js', 'Injected', 'rgb(31, 32, 33)']
    ]

    for (const [file, name, color] of emitted) {
      const script = built.read(file)

      // The rule carries the class Svelte scoped it with.
      expect(script).toContain(`.probe_${name}.svelte-`)
      expect(script).toContain(`{ color: ${color}; }`)

      // One <style> element, which is what applies it on the page.
      expect(script).toContain('data-extjs-sfc-style')
      expect(script).toContain('createElement("style")')
      expect(script).not.toContain('data:text/css')
      expect(script).not.toContain('sourceMappingURL')
    }

    // A content script ships no sheet of its own for a block.
    expect(built.css).not.toContain('probe_Isolated')
  }, 180_000)

  it("keeps a page component's block in the page's own sheet", async () => {
    const built = await build(project({sideEffectsFree: false}))

    expect(built.css).toMatch(/\.probe_Page\.svelte-[\w-]+\{color:#292a2b\}/)
    expect(built.read('action/index.js')).not.toContain('data-extjs-sfc-style')
  }, 180_000)
})

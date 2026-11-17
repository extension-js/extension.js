import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import {rspack} from '@rspack/core'
import {Parser} from 'acorn'
import {afterAll, describe, expect, it, vi} from 'vitest'
import contentScriptWrapper from '../steps/add-content-script-wrapper/content-script-wrapper'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-default-shapes-'))
  )
  roots.push(root)

  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n')
  fs.mkdirSync(path.join(root, 'content'))
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'shapes',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content/main.js']}]
    })
  )

  return root
}

// The wrapper loader on one content script, as a production build runs it.
function wrap(source: string) {
  const root = project()
  const resourcePath = path.join(root, 'content', 'main.js')
  const emitWarning = vi.fn()

  fs.writeFileSync(resourcePath, source)

  const text = String(
    contentScriptWrapper.call(
      {
        resourcePath,
        _compilation: {},
        emitWarning,
        getOptions: () => ({
          manifestPath: path.join(root, 'manifest.json'),
          mode: 'production'
        })
      } as any,
      source
    )
  )
  const warnings = emitWarning.mock.calls.map(([error]) =>
    String((error as Error).message)
  )

  return {root, text, warnings}
}

function parseError(text: string) {
  try {
    Parser.parse(text, {ecmaVersion: 'latest', sourceType: 'module'})

    return ''
  } catch (error) {
    return String((error as Error).message)
  }
}

// A declaration of the mount name on a line that is not a comment.
function declaresMountName(text: string) {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .some((line) =>
      /\b(?:const|let|var|function)\s+__EXTENSIONJS_default__\b/.test(line)
    )
}

// Bundles the loader output in production inside the temp folder, then runs
// the bundle on a page stub and counts how often the default export ran.
async function buildAndRun(root: string, text: string) {
  const entry = path.join(root, 'wrapped.mjs')
  const output = path.join(root, 'dist')

  fs.writeFileSync(entry, text)

  const errors = await new Promise<string[]>((resolve, reject) => {
    const compiler = rspack({
      context: root,
      mode: 'production',
      devtool: false,
      entry: {wrapped: entry},
      output: {path: output}
    })

    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error) reject(error)
        else resolve((stats?.compilation.errors || []).map((e) => e.message))
      })
    })
  })
  const page: Record<string, unknown> = {
    document: {
      readyState: 'complete',
      addEventListener() {},
      removeEventListener() {}
    },
    console: {log() {}, warn() {}, error() {}},
    setTimeout,
    clearTimeout,
    queueMicrotask
  }
  page.globalThis = page
  page.window = page
  page.self = page

  let thrown = ''

  try {
    vm.runInNewContext(
      fs.readFileSync(path.join(output, 'wrapped.js'), 'utf8'),
      page
    )
  } catch (error) {
    thrown = String(error)
  }

  await new Promise((resolve) => setTimeout(resolve, 20))

  return {errors, thrown, ran: Number(page.ran || 0)}
}

const RUN = 'globalThis.ran = (globalThis.ran || 0) + 1'
const exportDefaults = (text: string) =>
  (text.match(/\bexport\s+default\b/g) || []).length

describe('the content script wrapper on default export shapes', () => {
  it('mounts a plain default export once, the shape the pins below miss', async () => {
    const {root, text, warnings} = wrap(
      `export default function main() { ${RUN} }\n`
    )

    expect(exportDefaults(text)).toBe(1)
    expect(declaresMountName(text)).toBe(true)
    expect(parseError(text)).toBe('')
    expect(warnings).toEqual([])
    expect(await buildAndRun(root, text)).toEqual({
      errors: [],
      thrown: '',
      ran: 1
    })
  })

  it('leaves a named default export beside the one it adds and never runs it', async () => {
    // Pins today's behavior. Ledger 1384 D1.
    const {root, text, warnings} = wrap(
      `function main() { ${RUN} }\nexport { main as default }\n`
    )

    expect(exportDefaults(text)).toBe(1)
    expect(text).toContain('export { main as default }')
    expect(text).toContain('export default __EXTENSIONJS_default__')
    expect(declaresMountName(text)).toBe(false)
    expect(parseError(text)).toMatch(/^Duplicate export 'default' \(\d+:7\)$/)
    expect(warnings).toEqual([])
    // The bundler accepts it, and the page runs nothing and says nothing.
    expect(await buildAndRun(root, text)).toEqual({
      errors: [],
      thrown: '',
      ran: 0
    })
  })

  it('rewrites a default export written in a comment and keeps the real one', async () => {
    // Pins today's behavior. Ledger 1384 D1.
    const {root, text, warnings} = wrap(
      '// usage: export default function main() {}\n' +
        `export default function main() { ${RUN} }\n`
    )

    expect(exportDefaults(text)).toBe(2)
    expect(text).toContain(
      '// usage: const __EXTENSIONJS_default__ = function main() {}'
    )

    expect(text).toContain(`export default function main() { ${RUN} }`)
    expect(declaresMountName(text)).toBe(false)
    expect(parseError(text)).toMatch(/^Duplicate export 'default' \(\d+:7\)$/)
    expect(warnings).toEqual([])
    expect(await buildAndRun(root, text)).toEqual({
      errors: [],
      thrown: '',
      ran: 0
    })
  })

  it('deletes a call to the default export inside a timer callback', () => {
    // Pins today's behavior. Ledger 1384 D4.
    const {text, warnings} = wrap(
      'export default function main() {}\n' +
        'setTimeout(() => {\n  main()\n}, 50)\n'
    )

    expect(text).toContain(
      'const __EXTENSIONJS_default__ = function main() {}\n' +
        'setTimeout(() => {\n\n}, 50)\n'
    )

    expect(warnings).toEqual([
      'Removed direct call to main() to prevent double mount; wrapper handles mounting.'
    ])
  })
})

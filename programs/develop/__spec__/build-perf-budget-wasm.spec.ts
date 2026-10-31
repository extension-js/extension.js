import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// A vendor wasm runtime (onnxruntime-web, ffmpeg) is fetched when a page or
// a worker runs the model and cannot be split, so its 26 MB must not turn
// every build into "compiled with warnings". The same bytes reached by a
// content script are paid for on every navigation and still warn.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
const ORT_BYTES = 26 * 1000 * 1000
const CORE_BYTES = 2 * 1024 * 1024

function wasmFile(bytes: number) {
  return Buffer.concat([WASM_MAGIC, Buffer.alloc(bytes - WASM_MAGIC.length, 0)])
}

function page(script: string) {
  return `<!doctype html><html><body><script src="${script}"></script></body></html>`
}

function project(kind: 'page-and-worker' | 'content-script', config?: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-wasm-budget-'))
  roots.push(root)

  const files: Record<string, Buffer | string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'wasm-budget',
      version: '0.0.0'
    }),
    'ort-wasm-simd-threaded.asyncify.wasm': wasmFile(ORT_BYTES),
    'core.wasm': wasmFile(CORE_BYTES),
    'engine/index.html': page('./index.js'),
    'engine/index.js': [
      'import ortUrl from "../ort-wasm-simd-threaded.asyncify.wasm?url"',
      'const worker = new Worker(new URL("./worker.js", import.meta.url))',
      'worker.postMessage({ortUrl})',
      ''
    ].join('\n'),
    'engine/worker.js': [
      'import coreUrl from "../core.wasm?url"',
      'self.onmessage = (event) => console.log("WASM_WORKER", coreUrl, event.data)',
      ''
    ].join('\n')
  }

  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: 'wasm-budget',
    version: '1.0.0',
    options_page: 'engine/index.html'
  }

  if (kind === 'content-script') {
    files['content/scripts.js'] = [
      'import ortUrl from "../ort-wasm-simd-threaded.asyncify.wasm?url"',
      'console.log("WASM_CONTENT", ortUrl)',
      ''
    ].join('\n')

    manifest.content_scripts = [
      {matches: ['<all_urls>'], js: ['content/scripts.js']}
    ]
  }

  files['manifest.json'] = JSON.stringify(manifest)
  if (config) files['extension.config.js'] = config

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  logSpy.mockRestore()
})

function summaryLine(): string {
  const lines = logSpy.mock.calls.map((call: unknown[]) =>
    call.map(String).join(' ')
  )

  return lines.find((line: string) => /compiled.* in \d+ ms\./.test(line)) || ''
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const files = fs
      .readdirSync(distDir, {recursive: true})
      .map((file) => String(file).split(path.sep).join('/'))
      .filter((file) => fs.statSync(path.join(distDir, file)).isFile())

    return {summary, files, line: summaryLine()}
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

describe('a wasm runtime under the performance budget of a production build', () => {
  it('ships a 26 MB core reached by a page and a worker with no warning, and the summary reads compiled', async () => {
    const {summary, files, line} = await build(project('page-and-worker'))

    const emitted = files.filter((file) => file.endsWith('.wasm')).sort()
    expect(emitted, files.join(',')).toHaveLength(2)
    expect(emitted[0]).toMatch(/^assets\/core\.[0-9a-f]{8}\.wasm$/)
    expect(emitted[1]).toMatch(
      /^assets\/ort-wasm-simd-threaded\.asyncify\.[0-9a-f]{8}\.wasm$/
    )

    expect(summary.warnings_count).toBe(0)
    expect(summary.warnings).toBeUndefined()
    expect(line).toMatch(/ compiled in \d+ ms\./)
    expect(line).not.toContain('with warnings')
  }, 180_000)

  it('still warns for the same core when a content script reaches it', async () => {
    const {summary, line} = await build(project('content-script'))

    expect(summary.warnings_count).toBe(1)
    const warning = String(summary.warnings?.[0] || '')
    expect(warning).toContain('E_PERF_BUDGET')
    expect(warning).toMatch(
      /assets\/ort-wasm-simd-threaded\.asyncify\.[0-9a-f]{8}\.wasm/
    )

    expect(warning).toContain('reached by a content script')
    expect(warning).not.toMatch(/assets\/core\.[0-9a-f]{8}\.wasm/)
    expect(line).toContain('with warnings')
  }, 180_000)

  it('is silenced by perfBudgets.ignore in extension.config.js', async () => {
    const {summary, line} = await build(
      project(
        'content-script',
        [
          'module.exports = {',
          "  perfBudgets: {ignore: ['assets/ort-wasm-simd-threaded.asyncify.*.wasm']}",
          '}',
          ''
        ].join('\n')
      )
    )

    expect(summary.warnings_count).toBe(0)
    expect(line).toMatch(/ compiled in \d+ ms\./)
    expect(line).not.toContain('with warnings')
  }, 180_000)
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A `.wasm?url` import ships the binary as an emitted file and hands the
// code its URL, so a loader that fetches its own bytes (emscripten, zstd)
// needs no module.rules surgery. The plain import stays an async wasm module.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// Larger than the asset inline threshold, so the file cannot become a data URI.
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
const WASM_BYTES = Buffer.concat([WASM_MAGIC, Buffer.alloc(4096, 0)])

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-wasm-url-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'wasm-url', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'codec.wasm'), WASM_BYTES)
  fs.mkdirSync(path.join(root, 'page'))
  fs.writeFileSync(
    path.join(root, 'page', 'index.html'),
    '<!doctype html><html><body><script src="./page.js"></script></body></html>'
  )

  fs.writeFileSync(
    path.join(root, 'page', 'page.js'),
    [
      'import codecUrl from "../codec.wasm?url"',
      'console.log("WASM_URL_PAGE", codecUrl)',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'background.js'),
    [
      'import codecUrl from "./codec.wasm?url"',
      'console.log("WASM_URL_WORKER", codecUrl)',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'wasm-url',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      options_page: 'page/index.html'
    })
  )

  return root
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
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', 'chrome')
  const files = fs
    .readdirSync(distDir, {recursive: true})
    .map((file) => String(file).split(path.sep).join('/'))
    .filter((file) => fs.statSync(path.join(distDir, file)).isFile())
  const read = (file: string) => fs.readFileSync(path.join(distDir, file))

  return {files, read}
}

describe('a .wasm?url import in a production build', () => {
  it('emits the binary once as an asset and references it from the page and the worker', async () => {
    const root = project()
    const {files, read} = await build(root)

    const emitted = files.filter((file) => file.endsWith('.wasm'))
    expect(emitted, files.join(',')).toHaveLength(1)
    expect(emitted[0]).toMatch(/^assets\/codec\.[0-9a-f]{8}\.wasm$/)
    expect(read(emitted[0]).equals(WASM_BYTES)).toBe(true)

    const worker = files.find((file) =>
      read(file).toString('utf8').includes('WASM_URL_WORKER')
    )
    const page = files.find((file) =>
      read(file).toString('utf8').includes('WASM_URL_PAGE')
    )
    expect(worker, files.join(',')).toBeDefined()
    expect(page, files.join(',')).toBeDefined()

    // The URL is the emitted path, not an instantiated module or a data URI.
    for (const bundle of [worker, page] as string[]) {
      const source = read(bundle).toString('utf8')
      expect(source, bundle).toContain(emitted[0])
      expect(source, bundle).not.toContain('data:application/wasm')
      expect(source, bundle).not.toContain('WebAssembly.instantiate')
    }
  })
})

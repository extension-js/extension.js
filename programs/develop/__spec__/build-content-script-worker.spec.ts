import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// The worker file ships from every surface, but the browser only starts it
// where the document is the extension. A content script has to hear that.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cs-worker-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'cs-worker', version: '0.0.0'})
  )

  fs.mkdirSync(path.join(root, 'content'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'content', 'worker.js'),
    'self.onmessage = () => {\n  self.postMessage("WORKER_BODY_MARK_4f1c")\n}\n'
  )

  fs.writeFileSync(
    path.join(root, 'content', 'index.js'),
    [
      'const worker = new Worker(new URL("./worker.js", import.meta.url))',
      'worker.postMessage("go")',
      ''
    ].join('\n')
  )

  fs.mkdirSync(path.join(root, 'public'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'public', 'worker.js'),
    'self.onmessage = () => {\n  self.postMessage("PUBLIC_WORKER_MARK")\n}\n'
  )

  fs.mkdirSync(path.join(root, 'blob'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'blob', 'index.js'),
    [
      'async function start() {',
      '  const href = chrome.runtime.getURL("worker.js")',
      '  const body = await (await fetch(href)).text()',
      '  return new Worker(URL.createObjectURL(new Blob([body])))',
      '}',
      'start()',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'popup.js'),
    [
      'const worker = new Worker(new URL("./content/worker.js", import.meta.url))',
      'worker.postMessage("go")',
      ''
    ].join('\n')
  )

  fs.writeFileSync(
    path.join(root, 'popup.html'),
    '<html><body><script src="./popup.js"></script></body></html>\n'
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'cs-worker',
      version: '1.0.0',
      action: {default_popup: 'popup.html'},
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content/index.js']},
        {matches: ['<all_urls>'], js: ['blob/index.js']}
      ]
    })
  )

  return root
}

async function build(root: string, browser = 'chrome') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function workerWarnings(summary: {warnings?: string[]}) {
  return (summary.warnings || []).filter((text) =>
    text.includes('starts a worker with new Worker(new URL(...))')
  )
}

describe('a worker spelled in a content script', () => {
  it('ships the worker file and names the origin the browser refuses', async () => {
    const root = project()
    const summary = await build(root)
    expect(summary.errors_count).toBe(0)

    const distDir = path.join(root, 'dist', 'chrome')
    const files = fs
      .readdirSync(distDir, {recursive: true})
      .map((file) => String(file).split(path.sep).join('/'))
      .filter((file) => fs.statSync(path.join(distDir, file)).isFile())
    const read = (file: string) =>
      fs.readFileSync(path.join(distDir, file), 'utf8')

    // The emit half already works: the worker body is its own file, not a
    // module folded into the bundle that starts it.
    const contentScript = 'content_scripts/content-0.js'
    expect(files, files.join(',')).toContain(contentScript)
    const workerFiles = files.filter(
      (file) =>
        file !== contentScript && read(file).includes('WORKER_BODY_MARK_4f1c')
    )
    expect(workerFiles, files.join(',')).not.toHaveLength(0)
    expect(read(contentScript)).not.toContain('WORKER_BODY_MARK_4f1c')

    // The content script asks the runtime for one of those files by chunk id,
    // which is how the emitted URL reaches the worker at all.
    const chunkIds = workerFiles.map((file) =>
      file.split(/[\\/]/).pop()?.replace(/\.js$/, '')
    )
    expect(
      chunkIds.some((id) =>
        new RegExp(`\\.u\\(${id}\\)`).test(read(contentScript))
      ),
      chunkIds.join(',')
    ).toBe(true)

    const warnings = workerWarnings(summary)
    expect(warnings, warnings.join('\n')).toHaveLength(1)
    expect(warnings[0]).toContain(
      'content_scripts/content-0.js starts a worker with new Worker(new URL(...)), which the browser refuses in a content script'
    )

    expect(warnings[0]).toContain('SCRIPT content_scripts/content-0.js')
    expect(warnings[0]).toContain(
      'a worker script must be same-origin with the document that starts it, and this document is the page, so the worker never runs'
    )

    // Measured on both engines, and the copy says which is which.
    expect(warnings[0]).toContain('Chromium throws a SecurityError')
    expect(warnings[0]).toContain('Firefox fires an error event on the worker')

    expect(warnings[0]).toContain('URL.createObjectURL(new Blob(')
    expect(warnings[0]).toContain('start the worker from an extension page')

    // The page surface keeps the spelling, and the blob shape the message
    // names is the one shape that must never be warned about.
    expect(warnings[0]).not.toContain('action/index.js')
    expect(warnings[0]).not.toContain('content_scripts/content-1.js')
  }, 180_000)

  it('says it for a gecko build too, where the worker also never runs', async () => {
    const root = project()
    const summary = await build(root, 'firefox')
    expect(summary.errors_count).toBe(0)

    const warnings = workerWarnings(summary)
    expect(warnings, warnings.join('\n')).toHaveLength(1)
    expect(warnings[0]).toContain(
      'content_scripts/content-0.js starts a worker with new Worker(new URL(...)), which the browser refuses in a content script'
    )
  }, 180_000)
})

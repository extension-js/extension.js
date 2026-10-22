import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

// A single-use const read from a global, a delete of that same property, then
// the const handed to a function the minifier can inline the call site of.
const CONTENT_SCRIPT = [
  'function pickVideo(src) {',
  "  for (const video of document.querySelectorAll('video')) {",
  '    if (video.currentSrc === src || video.src === src) return video',
  '  }',
  '  return null',
  '}',
  '',
  'export default function initial() {',
  '  const wantedLiveSource = globalThis.__leonLiveSrc',
  '  delete globalThis.__leonLiveSrc',
  '  const video = pickVideo(wantedLiveSource)',
  "  document.title = video ? video.currentSrc : 'none'",
  "  console.log('video', video)",
  '}',
  ''
].join('\n')

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-read-delete-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'read-delete', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'content.js'), CONTENT_SCRIPT)
  fs.writeFileSync(path.join(root, 'background.js'), 'export {}\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'read-delete',
      version: '1.0.0',
      background: {service_worker: 'background.js'},
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })
  )

  return root
}

async function build(root: string) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  let summary: Awaited<ReturnType<typeof extensionBuild>>

  try {
    summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
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
  const scriptName = files.find((file) => /content_scripts\/.*\.js$/.test(file))
  expect(scriptName, files.join(',')).toBeDefined()

  return fs.readFileSync(path.join(distDir, String(scriptName)), 'utf8')
}

describe('production minifier keeps a property read ahead of its delete', () => {
  it('stores the read before the delete instead of inlining it past it', async () => {
    const script = await build(project())

    // The build ran the minifier: the long local name is gone.
    expect(script).not.toContain('wantedLiveSource')

    const read = script.indexOf('=globalThis.__leonLiveSrc')
    const remove = script.indexOf('delete globalThis.__leonLiveSrc')
    expect(remove, script).toBeGreaterThan(-1)
    expect(read, script).toBeGreaterThan(-1)
    expect(read, script).toBeLessThan(remove)
    expect(script).not.toMatch(
      /delete globalThis\.__leonLiveSrc[\s\S]*\(globalThis\.__leonLiveSrc\)/
    )
  }, 180_000)
})

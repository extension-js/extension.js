import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const CONTENT_SCRIPT = [
  'export default function initial() {',
  "  const greetingForTheReviewer = 'hello from the spec'",
  '  console.log(greetingForTheReviewer)',
  '}',
  ''
].join('\n')

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-opera-minify-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'readable', version: '0.0.0'})
  )

  fs.writeFileSync(path.join(root, 'content.js'), CONTENT_SCRIPT)
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'readable',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
    })
  )

  return root
}

async function build(
  root: string,
  browser: 'chrome' | 'opera',
  minify?: boolean
) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  let summary: Awaited<ReturnType<typeof extensionBuild>>

  try {
    summary = await extensionBuild(root, {
      browser,
      silent: true,
      install: false,
      minify,
      exitOnError: false
    } as any)

    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  const distDir = path.join(root, 'dist', browser)
  const files = fs
    .readdirSync(distDir, {recursive: true})
    .map((file) => String(file).split(path.sep).join('/'))
  const scriptName = files.find((file) => /content_scripts\/.*\.js$/.test(file))
  expect(scriptName, files.join(',')).toBeDefined()

  return fs.readFileSync(path.join(distDir, String(scriptName)), 'utf8')
}

describe('production builds for the Opera store keep first-party code readable', () => {
  it('minifies for chrome and leaves opera readable by default', async () => {
    const chrome = await build(project(), 'chrome')
    const opera = await build(project(), 'opera')

    expect(chrome).not.toContain('greetingForTheReviewer')
    expect(opera).toContain('greetingForTheReviewer')
    expect(opera).toContain('hello from the spec')
    expect(opera.length).toBeGreaterThan(chrome.length)
  }, 180_000)

  it('follows an explicit minify option on either target', async () => {
    const operaMinified = await build(project(), 'opera', true)
    const chromeReadable = await build(project(), 'chrome', false)

    expect(operaMinified).not.toContain('greetingForTheReviewer')
    expect(chromeReadable).toContain('greetingForTheReviewer')
  }, 180_000)
})

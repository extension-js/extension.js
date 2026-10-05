import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {stripAnsi} from '../dev-server/lifecycle-stream'

type Mode = 'development' | 'production' | 'none'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'extjs-size-'))
  )
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'size', version: '0.0.0'})
  )

  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'size',
      version: '1.0.0',
      default_locale: 'en',
      background: {service_worker: 'background.js'},
      action: {default_popup: 'popup/index.html'},
      content_scripts: [
        {
          matches: ['https://example.com/*'],
          js: ['content/scripts.js'],
          css: ['content/styles.css']
        }
      ]
    })
  )

  fs.mkdirSync(path.join(root, 'popup'))
  fs.mkdirSync(path.join(root, 'content'))
  fs.mkdirSync(path.join(root, 'public', 'img'), {recursive: true})
  fs.mkdirSync(path.join(root, '_locales', 'en'), {recursive: true})
  fs.writeFileSync(path.join(root, 'background.js'), 'console.log("bg")\n')
  fs.writeFileSync(
    path.join(root, 'popup', 'index.html'),
    '<!doctype html><title>p</title><link rel="stylesheet" href="./styles.css" /><script src="./scripts.js"></script>'
  )

  fs.writeFileSync(path.join(root, 'popup', 'styles.css'), 'body{margin:0}\n')
  fs.writeFileSync(
    path.join(root, 'popup', 'scripts.js'),
    'document.title = "popup"\n'
  )

  fs.writeFileSync(
    path.join(root, 'content', 'scripts.js'),
    'document.documentElement.dataset.size = "content"\n'
  )

  fs.writeFileSync(
    path.join(root, 'content', 'styles.css'),
    'html{outline:1px solid tomato}\n'
  )

  fs.writeFileSync(
    path.join(root, 'public', 'img', 'dot.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'
  )

  fs.writeFileSync(
    path.join(root, '_locales', 'en', 'messages.json'),
    JSON.stringify({hello: {message: 'Hello'}})
  )

  return root
}

async function build(root: string, mode: Mode) {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  const lines: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => lines.push(args.join(' '))

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: false,
      install: false,
      mode,
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)

    return {summary, output: stripAnsi(lines.join('\n'))}
  } finally {
    console.log = originalLog
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

function walk(dir: string) {
  return fs
    .readdirSync(dir, {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      size: fs.statSync(path.join(entry.parentPath, entry.name)).size
    }))
}

const sum = (files: Array<{size: number}>) =>
  files.reduce((total, file) => total + file.size, 0)

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function builtAndWalked(mode: Mode) {
  const root = project()
  const {summary, output} = await build(root, mode)
  const files = walk(path.join(root, 'dist', 'chrome'))
  const maps = files.filter((file) => file.name.endsWith('.map'))

  return {summary, output, files, maps}
}

function expectReportMatchesFolder(
  built: Awaited<ReturnType<typeof builtAndWalked>>
) {
  const {summary, output, files} = built

  expect(files.length).toBeGreaterThan(0)
  expect(summary.total_bytes).toBe(sum(files))
  expect(summary.total_assets).toBe(files.length)
  expect(summary.largest_asset_bytes).toBe(
    Math.max(...files.map((file) => file.size))
  )

  expect(output).toContain(`dist/chrome (${humanSize(sum(files))}).`)
}

describe('the size a build reports', () => {
  it('counts the source maps of a development build', async () => {
    const built = await builtAndWalked('development')

    expect(built.maps.length).toBeGreaterThan(0)
    expectReportMatchesFolder(built)
    expect(built.output).toContain(
      `+ ${built.maps.length} source maps not shown (${(sum(built.maps) / 1024).toFixed(2)}KB)`
    )

    expect(built.output.match(/not shown/g)).toHaveLength(1)
    expect(built.output).not.toMatch(/\.map \(/)
  }, 180_000)

  it('counts the source maps of a build with no mode', async () => {
    const built = await builtAndWalked('none')

    expect(built.maps.length).toBeGreaterThan(0)
    expectReportMatchesFolder(built)
    expect(built.output).toContain(
      `+ ${built.maps.length} source maps not shown (${(sum(built.maps) / 1024).toFixed(2)}KB)`
    )
  }, 180_000)

  it('equals the folder of a production build and folds nothing', async () => {
    const built = await builtAndWalked('production')

    expect(built.maps).toHaveLength(0)
    expectReportMatchesFolder(built)
    expect(built.output).not.toContain('not shown')
  }, 180_000)
})

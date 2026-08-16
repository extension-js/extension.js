import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-devtools-panel-'))

function write(relPath: string, contents: string) {
  const abs = path.join(ROOT, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

beforeAll(() => {
  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Devtools Panel Fixture',
      version: '1.0.0',
      devtools_page: 'devtools.html'
    })
  )
  write('devtools.html', '<html><script src="devtools.js"></script></html>\n')
  write(
    'devtools.js',
    'chrome.devtools.panels.create("My Panel", "", "panel.html", function () {})\n'
  )
  write(
    'panel.html',
    '<html><body><h1>panel</h1><script src="panel.js"></script></body></html>\n'
  )
  write('panel.js', 'console.log("panel alive")\n')
})

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('devtools panels.create page (real build)', () => {
  it('ships the panel page and its script in dist', async () => {
    const {extensionBuild} = await import('../command-build')
    await extensionBuild(ROOT, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)

    const dist = path.join(ROOT, 'dist', 'chrome')
    expect(fs.existsSync(path.join(dist, 'panel.html'))).toBe(true)
    expect(fs.existsSync(path.join(dist, 'panel.js'))).toBe(true)
    expect(fs.existsSync(path.join(dist, 'devtools', 'index.html'))).toBe(true)
  }, 120_000)
})

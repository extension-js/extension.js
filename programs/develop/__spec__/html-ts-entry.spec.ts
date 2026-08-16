import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-html-ts-'))

function write(relPath: string, contents: string) {
  const abs = path.join(ROOT, relPath)
  fs.mkdirSync(path.dirname(abs), {recursive: true})
  fs.writeFileSync(abs, contents)
}

beforeAll(() => {
  write('package.json', JSON.stringify({private: true, name: 'html-ts-spec'}))
  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Html TS Fixture',
      version: '1.0.0',
      action: {default_popup: 'popup.html'}
    })
  )
  write(
    'popup.html',
    '<html><body><script src="./popup.ts"></script></body></html>\n'
  )
  write('popup.ts', 'const n: number = 41\nconsole.log(n + 1)\n')
  write(
    'pages/custom.html',
    '<html><body><script type="module" src="./custom.ts"></script></body></html>\n'
  )
  write('pages/custom.ts', 'const w: string = "hi"\nexport const v = w\n')
})

afterAll(() => {
  fs.rmSync(ROOT, {recursive: true, force: true})
})

describe('html-declared TypeScript entries (real build)', () => {
  it('compiles .ts scripts referenced only from page html, no tsconfig upfront', async () => {
    const {extensionBuild} = await import('../command-build')
    await extensionBuild(ROOT, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode: 'production',
      exitOnError: false
    } as never)

    const dist = path.join(ROOT, 'dist', 'chrome')
    const popupJs = fs.readFileSync(
      path.join(dist, 'action', 'index.js'),
      'utf-8'
    )
    expect(popupJs).not.toContain(': number')
    expect(popupJs).toContain('42')

    const pageJs = fs.readFileSync(
      path.join(dist, 'pages', 'custom.js'),
      'utf-8'
    )
    expect(pageJs).not.toContain(': string')

    // The build scaffolds the tsconfig beside package.json on its own.
    expect(fs.existsSync(path.join(ROOT, 'tsconfig.json'))).toBe(true)
  }, 120_000)
})

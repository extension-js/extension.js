import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'

// A stylesheet the parser rejects ships as authored with one warning in
// development. Production must keep every rule development keeps: the
// minimizer may not drop a sheet, or half of one, that the browser accepts.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const CASES = {
  'unclosed-at-rule':
    '.keep-a { color: red }\n@media (max-width: 600px {\n.keep-b { color: blue }\n}\n.keep-c { color: green }\n',
  'unterminated-string':
    '.keep-a { color: red }\n.keep-b { content: "unterminated; }\n.keep-c { color: green }\n'
}

function project(css: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-css-parity-'))
  roots.push(root)
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({private: true, name: 'parity', version: '0.0.0'})
  )
  fs.writeFileSync(path.join(root, 'content.js'), 'console.log("cs")\n')
  fs.writeFileSync(path.join(root, 'content.css'), css)
  fs.writeFileSync(path.join(root, 'theme.css'), '.theme { color: pink }\n')
  fs.writeFileSync(path.join(root, 'bg.png'), 'PNGDATA\n')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'parity',
      version: '1.0.0',
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content.js'], css: ['content.css']}
      ]
    })
  )
  return root
}

async function build(root: string, mode: 'development' | 'production') {
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
    expect(summary.errors_count).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
  const distDir = path.join(root, 'dist', 'chrome')
  const files = fs.readdirSync(distDir, {recursive: true}).map(String)
  const text = files
    .filter((file) => file.endsWith('.css') || file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(distDir, file), 'utf8'))
    .join('\n')
  return {files, text}
}

const rulesIn = (text: string) =>
  ['keep-a', 'keep-b', 'keep-c'].filter((name) => text.includes(name))

describe('a sheet the parser rejects still ships what it references', () => {
  it('emits the @import target and the url() image beside the shipped sheet', async () => {
    const built = await build(
      project(
        '@import "./theme.css";\n.keep-a { background: url(./bg.png) }\n.keep-b { content: "unterminated; }\n'
      ),
      'production'
    )
    const sheet = built.files.find(
      (file) => file.endsWith('.css') && !file.endsWith('theme.css')
    )
    expect(sheet, built.files.join(',')).toBeDefined()
    const dir = path.posix.dirname(String(sheet))
    expect(built.files).toContain(path.posix.join(dir, 'theme.css'))
    expect(built.files).toContain(path.posix.join(dir, 'bg.png'))
    expect(built.text).toContain('keep-b')
  }, 180_000)
})

describe('production keeps every rule development keeps for an unparseable sheet', () => {
  for (const [name, css] of Object.entries(CASES)) {
    it(name, async () => {
      const dev = await build(project(css), 'development')
      const prod = await build(project(css), 'production')
      expect(
        rulesIn(dev.text).length,
        `dev keeps ${rulesIn(dev.text)}`
      ).toBeGreaterThan(0)
      expect(rulesIn(prod.text), `${name}: prod vs dev`).toEqual(
        rulesIn(dev.text)
      )
    }, 180_000)
  }
})

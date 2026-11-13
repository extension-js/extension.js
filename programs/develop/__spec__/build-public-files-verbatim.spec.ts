import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'

// A file under public/ and a file `include` declares ship as authored, so a
// production build writes the same bytes a development build does.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const COPIED: Record<string, string> = {
  'raw-plain.js': 'const rawPlain = 20\nrawPlain + 22\n',
  'raw-effect.js': 'document.title.length + 37\n',
  'lib/commented.js':
    '/*! kept license banner */\n// a plain comment\n' +
    'var libCommented = { answer: 42 };\n\nlibCommented.answer\n',
  'vendor.min.js':
    'var vendored=function(){return 42}();\nvendored\n' +
    '//# sourceMappingURL=vendor.min.js.map\n',
  'vendor.min.js.map':
    '{"version":3,"sources":["vendor.js"],"names":[],"mappings":"AAAA"}\n',
  'raw-module.mjs':
    'export const answer = 40 + 2;\nexport default function start() {\n' +
    '  return answer;\n}\n',
  'crlf.js': 'var crlf = 40\r\ncrlf + 2\r\n',
  'raw.css':
    '/* authored sheet */\n.raw   {\n  color: #ff0000;\n' +
    '  margin: 0px 0px 0px 0px;\n}\n',
  'data.json': '{\n  "spaced":   true,\n  "list": [1, 2, 3]\n}\n'
}

const DECLARED = 'var declared = 40\ndeclared + 2\n'

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-public-verbatim-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'public-verbatim',
      version: '0.0.0'
    }),
    'background.js': 'console.log("PUBLIC_VERBATIM_BACKGROUND")\n',
    'vendor/declared.js': DECLARED,
    'extension.config.mjs':
      'export default {include: {"declared/run.js": "vendor/declared.js"}}\n',
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'public-verbatim',
      version: '1.0.0',
      background: {
        scripts: ['background.js'],
        'chromium:service_worker': 'background.js'
      },
      browser_specific_settings: {gecko: {id: 'public-verbatim@example.com'}}
    })
  }

  for (const [name, contents] of Object.entries(COPIED)) {
    all[path.join('public', name)] = contents
  }

  for (const [name, contents] of Object.entries(all)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), {recursive: true})
    fs.writeFileSync(file, contents)
  }

  return root
}

async function build(browser: 'chrome' | 'firefox') {
  const root = project()
  const {extensionBuild} = await import('../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser,
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

  const distDir = path.join(root, 'dist', browser)

  return {
    bytes: (file: string) => fs.readFileSync(path.join(distDir, file)),
    has: (file: string) => fs.existsSync(path.join(distDir, file))
  }
}

// What executeScript resolves with: the value the file's last statement left.
const completionValue = (text: string) =>
  vm.runInNewContext(text, {document: {title: 'probe'}})

describe.each([
  'chrome',
  'firefox'
] as const)('a production %s build of public/ and include files', (browser) => {
  it('writes every copied file byte for byte', async () => {
    const built = await build(browser)

    for (const [name, contents] of Object.entries(COPIED)) {
      expect(
        built.bytes(name).equals(Buffer.from(contents)),
        `${name} ships as authored`
      ).toBe(true)
    }

    expect(built.bytes('declared/run.js').equals(Buffer.from(DECLARED))).toBe(
      true
    )
  }, 120_000)

  it('keeps the value a copied script ends on', async () => {
    const built = await build(browser)
    const run = (name: string) =>
      completionValue(built.bytes(name).toString('utf8'))

    expect(run('raw-plain.js')).toBe(42)
    expect(run('raw-effect.js')).toBe(42)
    expect(run('vendor.min.js')).toBe(42)
    expect(run('crlf.js')).toBe(42)
    expect(run('declared/run.js')).toBe(42)
  }, 120_000)

  it('keeps the source map comment and extracts no license file', async () => {
    const built = await build(browser)

    expect(built.bytes('vendor.min.js').toString('utf8')).toContain(
      '//# sourceMappingURL=vendor.min.js.map'
    )

    expect(built.has('lib/commented.js.LICENSE.txt')).toBe(false)
  }, 120_000)

  it('still minifies the bundle the build compiles', async () => {
    const built = await build(browser)
    const file =
      browser === 'chrome'
        ? 'background/service_worker.js'
        : 'background/scripts.js'
    const background = built.bytes(file).toString('utf8')

    expect(background).toContain('PUBLIC_VERBATIM_BACKGROUND')
    expect(background.trim().split('\n').length).toBeLessThanOrEqual(2)
  }, 120_000)
})

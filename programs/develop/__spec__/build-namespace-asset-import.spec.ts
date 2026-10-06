import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it, vi} from 'vitest'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

const TEXT_RULE_CONFIG = [
  'module.exports = {',
  '  configResolved: (config) => {',
  "    config.module.rules.push({test: /document\\.js$/, type: 'asset/source'})",
  '    return config',
  '  }',
  '}',
  ''
].join('\n')

function project(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-namespace-asset-'))
  roots.push(root)

  const all: Record<string, string> = {
    'package.json': JSON.stringify({
      private: true,
      name: 'namespace-asset',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'namespace-asset',
      version: '1.0.0',
      background: {service_worker: 'background.js'}
    }),
    ...files
  }

  for (const [rel, content] of Object.entries(all)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
  }

  return root
}

async function build(root: string, mode: 'production' | 'development') {
  const {extensionBuild} = await import('../command-build')
  const printed: string[] = []

  const record = (...args: unknown[]) => {
    printed.push(args.map(String).join(' '))
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation(record)
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(record)
  const previous = process.env.VITEST
  process.env.VITEST = 'true'
  let failure: unknown

  try {
    await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as never)
  } catch (error) {
    failure = error
  } finally {
    logSpy.mockRestore()
    errorSpy.mockRestore()

    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }

  return {
    failure,
    rendered: printed.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
  }
}

function runWorker(root: string) {
  const worker = fs.readFileSync(
    path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
    'utf8'
  )
  const sandbox: Record<string, unknown> = {console}
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  vm.runInNewContext(worker, sandbox)

  return sandbox
}

describe('a namespace import of a file that has one value', () => {
  it('fails the build when a script held as text is read as the value', async () => {
    const root = project({
      'extension.config.js': TEXT_RULE_CONFIG,
      'document.js': "window.NS_DOC_7b2e = 'injected'\n",
      'background.js': [
        "import * as doc from './document.js'",
        'globalThis.__injected = String(doc)',
        ''
      ].join('\n')
    })

    for (const mode of ['production', 'development'] as const) {
      const {failure, rendered} = await build(root, mode)

      expect(String(failure), mode).toMatch(/Build failed/)
      expect(rendered, mode).toContain(
        "import * as doc from './document.js' is a module object"
      )

      expect(rendered, mode).toContain("import doc from './document.js'")
      expect(rendered, mode).toContain('background.js')
    }
  }, 120_000)

  it('fails the build for a ?raw text and for an image read the same way', async () => {
    const root = project({
      'notes.md': '# NS_RAW_41c9\n',
      'logo.png': 'not a real png',
      'background.js': [
        "import * as notes from './notes.md?raw'",
        "import * as logo from './logo.png'",
        'globalThis.__values = [notes, logo]',
        ''
      ].join('\n')
    })

    const {failure, rendered} = await build(root, 'production')

    expect(String(failure)).toMatch(/Build failed/)
    expect(rendered).toContain(
      "import * as notes from './notes.md?raw' is a module object"
    )

    expect(rendered).toContain(
      "import * as logo from './logo.png' is a module object"
    )

    expect(rendered).toContain('Build failed with 2 errors')
  }, 120_000)

  it('builds every read of the default member and the default import', async () => {
    const root = project({
      'notes.md': 'NS_MEMBER_93fd',
      'background.js': [
        "import * as byMember from './notes.md?raw'",
        "import * as byOptional from './notes.md?raw&optional'",
        "import * as byKind from './notes.md?raw&kind'",
        "import byDefault from './notes.md?raw&default'",
        'globalThis.__values = {',
        '  member: byMember.default,',
        '  optional: byOptional?.default,',
        '  kind: typeof byKind,',
        '  byDefault',
        '}',
        ''
      ].join('\n')
    })

    for (const mode of ['production', 'development'] as const) {
      const {failure, rendered} = await build(root, mode)

      expect(failure, mode).toBeUndefined()
      expect(rendered, mode).not.toContain('is a module object')
      expect(runWorker(root).__values, mode).toEqual({
        member: 'NS_MEMBER_93fd',
        optional: 'NS_MEMBER_93fd',
        kind: 'object',
        byDefault: 'NS_MEMBER_93fd'
      })
    }
  }, 120_000)

  it('fails the build when the default member is taken by a pattern', async () => {
    const root = project({
      'notes.md': 'NS_PATTERN_c08d',
      'background.js': [
        "import * as notes from './notes.md?raw'",
        'const {default: text} = notes',
        'globalThis.__values = text',
        ''
      ].join('\n')
    })

    const {failure, rendered} = await build(root, 'production')

    expect(String(failure)).toMatch(/Build failed/)
    expect(rendered).toContain(
      "import * as notes from './notes.md?raw' is a module object"
    )
  }, 120_000)

  it('fails the build for a file the extension injects by name', async () => {
    const root = project({
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        name: 'namespace-asset',
        version: '1.0.0',
        permissions: ['scripting', 'activeTab'],
        action: {},
        background: {service_worker: 'background.js'}
      }),
      'background.js': [
        'chrome.action.onClicked.addListener((tab) => {',
        "  chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['inject/run.js']})",
        '})',
        ''
      ].join('\n'),
      'inject/run.js': [
        "import * as banner from './banner.md?raw'",
        'document.title = banner',
        ''
      ].join('\n'),
      'inject/banner.md': 'NS_CHILD_5a70\n'
    })

    const {failure, rendered} = await build(root, 'production')

    expect(String(failure)).toMatch(/Build failed/)
    expect(rendered).toContain(
      "import * as banner from './banner.md?raw' is a module object"
    )

    expect(rendered).toContain('inject/run.js')
  }, 120_000)
})

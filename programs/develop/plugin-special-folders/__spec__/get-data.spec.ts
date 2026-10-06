import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {getSpecialFoldersDataForCompiler} from '../get-data'

const getSpecialFoldersDataMock = vi.fn()
const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, {recursive: true, force: true})
  }
})

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')

  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    statSync: vi.fn(actual.statSync)
  }
})

vi.mock('browser-extension-manifest-fields', () => ({
  getSpecialFoldersData: (...args: any[]) => getSpecialFoldersDataMock(...args)
}))

describe('getSpecialFoldersDataForCompiler', () => {
  it('filters out public/ entries from pages and scripts', () => {
    getSpecialFoldersDataMock.mockReturnValue({
      pages: {
        'page-a': '/project/pages/a.html',
        'page-b': '/project/public/sample/pages/b.html',
        'page-c': 'public/sample/pages/c.html',
        'page-d': 'pages/d.html'
      },
      scripts: {
        'scripts/a': [
          '/project/scripts/a.js',
          '/project/public/sample/scripts/b.js',
          'public/sample/scripts/c.js'
        ]
      },
      public: {foo: 'bar'}
    })

    const compiler = {options: {context: '/project'}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(Object.values(data.pages || {})).toEqual([
      '/project/pages/a.html',
      'pages/d.html'
    ])

    expect(data.scripts?.['scripts/a']).toEqual(['/project/scripts/a.js'])
    expect((data as any).public).toEqual({foo: 'bar'})
  })

  it('drops Node build/dev tooling from scripts/ but keeps real content scripts (G13)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-g13-'))
    tempDirs.push(dir)
    const scriptsDir = path.join(dir, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})

    const shebang = path.join(scriptsDir, 'build-flow-scanner.js')
    const requiresTool = path.join(scriptsDir, 'release-build.js')
    const importsBuiltin = path.join(scriptsDir, 'sync.mjs')
    const contentScript = path.join(scriptsDir, 'content.js')
    const browserImport = path.join(scriptsDir, 'widget.js')

    fs.writeFileSync(shebang, '#!/usr/bin/env node\nconsole.log(1)\n', 'utf8')
    fs.writeFileSync(
      requiresTool,
      "const fx = require('fs-extra'); const z = require('zip-dir');\n",
      'utf8'
    )

    fs.writeFileSync(
      importsBuiltin,
      "import {readFile} from 'node:fs/promises'\n",
      'utf8'
    )

    fs.writeFileSync(contentScript, "document.body.dataset.ok = '1'\n", 'utf8')
    fs.writeFileSync(
      browserImport,
      "import merge from 'lodash/merge'\n",
      'utf8'
    )

    getSpecialFoldersDataMock.mockReturnValue({
      pages: {},
      scripts: {
        'scripts/build-flow-scanner': [shebang],
        'scripts/release-build': [requiresTool],
        'scripts/sync': [importsBuiltin],
        'scripts/content': [contentScript],
        'scripts/widget': [browserImport]
      },
      public: {}
    })

    const compiler = {options: {context: dir}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.scripts?.['scripts/build-flow-scanner']).toBeUndefined()
    expect(data.scripts?.['scripts/release-build']).toBeUndefined()
    expect(data.scripts?.['scripts/sync']).toBeUndefined()
    expect(data.scripts?.['scripts/content']).toEqual([contentScript])
    expect(data.scripts?.['scripts/widget']).toEqual([browserImport])
  })

  it('drops a scripts/ file that reaches a Node builtin through a sibling', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-sibling-'))
    tempDirs.push(dir)
    const scriptsDir = path.join(dir, 'scripts')
    fs.mkdirSync(path.join(scriptsDir, 'lib'), {recursive: true})

    const helper = path.join(scriptsDir, 'lib', 'helper.js')
    const tooling = path.join(scriptsDir, 'tooling.js')
    const loop = path.join(scriptsDir, 'loop.js')
    const widget = path.join(scriptsDir, 'widget.js')

    fs.writeFileSync(
      helper,
      "export {default as proc} from 'node:process'\n",
      'utf8'
    )

    fs.writeFileSync(
      tooling,
      "import {proc} from './lib/helper'\nconsole.log(proc.cwd())\n",
      'utf8'
    )

    fs.writeFileSync(loop, "import './loop.js'\nimport './widget.js'\n", 'utf8')
    fs.writeFileSync(
      widget,
      "import './loop.js'\ndocument.title = 'w'\n",
      'utf8'
    )

    getSpecialFoldersDataMock.mockReturnValue({
      pages: {},
      scripts: {
        'scripts/lib/helper': [helper],
        'scripts/tooling': [tooling],
        'scripts/loop': [loop],
        'scripts/widget': [widget]
      },
      public: {}
    })

    const compiler = {options: {context: dir}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.scripts?.['scripts/lib/helper']).toBeUndefined()
    expect(data.scripts?.['scripts/tooling']).toBeUndefined()
    expect(data.scripts?.['scripts/loop']).toEqual([loop])
    expect(data.scripts?.['scripts/widget']).toEqual([widget])
  })

  it('keeps a scripts/ file nothing references next to the referenced ones', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-g13gap-'))
    tempDirs.push(dir)
    const scriptsDir = path.join(dir, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})

    const contentScript = path.join(scriptsDir, 'content.js')
    const injectedScript = path.join(scriptsDir, 'injected.js')
    const orphanData = path.join(scriptsDir, 'cell.js')

    fs.writeFileSync(contentScript, "document.title = 'ok'\n", 'utf8')
    fs.writeFileSync(injectedScript, "console.log('injected')\n", 'utf8')
    fs.writeFileSync(
      orphanData,
      'data = {cell: 1}\nawait Promise.resolve()\n',
      'utf8'
    )

    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        content_scripts: [{matches: ['<all_urls>'], js: ['scripts/content.js']}]
      }),
      'utf8'
    )

    fs.writeFileSync(
      path.join(dir, 'background.js'),
      "chrome.scripting.executeScript({files: ['/scripts/injected.js']})\n",
      'utf8'
    )

    getSpecialFoldersDataMock.mockReturnValue({
      pages: {},
      scripts: {
        'scripts/content': [contentScript],
        'scripts/injected': [injectedScript],
        'scripts/cell': [orphanData]
      },
      public: {}
    })

    const compiler = {options: {context: dir}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.scripts?.['scripts/content']).toEqual([contentScript])
    expect(data.scripts?.['scripts/injected']).toEqual([injectedScript])
    expect(data.scripts?.['scripts/cell']).toEqual([orphanData])
  })

  it('keeps a scripts/ file nothing names and prints nothing about it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-dropwarn-'))
    tempDirs.push(dir)
    const scriptsDir = path.join(dir, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})

    const orphan = path.join(scriptsDir, 'never-mentioned.js')
    fs.writeFileSync(orphan, "console.log('orphan')\n", 'utf8')
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({manifest_version: 3}),
      'utf8'
    )

    getSpecialFoldersDataMock.mockReturnValue({
      pages: {},
      scripts: {'scripts/never-mentioned': [orphan]},
      public: {}
    })

    const compiler = {options: {context: dir}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.scripts?.['scripts/never-mentioned']).toEqual([orphan])
    const printed = [...warn.mock.calls, ...log.mock.calls]
      .map((call) => String(call[0]))
      .join('\n')
    expect(printed).not.toContain('never-mentioned')
    expect(printed).not.toContain('scripts/')
    warn.mockRestore()
    log.mockRestore()
  })

  // Regression: a TS entry is injected by its emitted `.js` name, never by the
  // `.ts` source path, so matching the source spelling alone dropped every
  // compiled scripts/ entry the project referenced correctly.
  it('keeps a compiled scripts/ entry referenced by its emitted .js path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-emitref-'))
    tempDirs.push(dir)
    const scriptsDir = path.join(dir, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})

    const source = path.join(scriptsDir, 'logger-client.ts')
    fs.writeFileSync(source, 'export const client = 1\n', 'utf8')
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        web_accessible_resources: [
          {resources: ['scripts/logger-client.js'], matches: ['<all_urls>']}
        ]
      }),
      'utf8'
    )

    getSpecialFoldersDataMock.mockReturnValue({
      pages: {},
      scripts: {'scripts/logger-client': [source]},
      public: {}
    })

    const compiler = {options: {context: dir}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.scripts?.['scripts/logger-client']).toEqual([source])
  })

  it('keeps all scripts/ entries when no reference assets are readable (fail open)', () => {
    getSpecialFoldersDataMock.mockReturnValue({
      pages: {},
      scripts: {'scripts/a': ['/does-not-exist/scripts/a.js']},
      public: {}
    })

    const compiler = {options: {context: '/does-not-exist'}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.scripts?.['scripts/a']).toEqual([
      '/does-not-exist/scripts/a.js'
    ])
  })

  it('auto-configures companion extensions scan from extensions/', () => {
    getSpecialFoldersDataMock.mockReturnValue({
      pages: {},
      scripts: {},
      public: {}
    })

    const existsSpy = vi.mocked(fs.existsSync).mockReturnValue(true as any)
    const statSpy = vi
      .mocked(fs.statSync)
      .mockReturnValue({isDirectory: () => true} as any)

    const compiler = {options: {context: '/project'}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.extensions).toEqual({dir: './extensions'})

    existsSpy.mockReset()
    statSpy.mockReset()
  })
})

describe('scripts/ entries the package.json scripts run', () => {
  function tooling(manifest: Record<string, unknown> = {manifest_version: 3}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-tooling-'))
    tempDirs.push(dir)
    const scriptsDir = path.join(dir, 'scripts')
    fs.mkdirSync(scriptsDir, {recursive: true})

    const helper = path.join(scriptsDir, 'replace_browser.js')
    const orphan = path.join(scriptsDir, 'forgotten.js')
    fs.writeFileSync(helper, "console.log('helper')\n", 'utf8')
    fs.writeFileSync(orphan, "console.log('orphan')\n", 'utf8')
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'tooling',
        scripts: {'build:firefox': 'node scripts/replace_browser.js firefox'}
      }),
      'utf8'
    )

    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(manifest),
      'utf8'
    )

    getSpecialFoldersDataMock.mockReturnValue({
      pages: {},
      scripts: {
        'scripts/replace_browser': [helper],
        'scripts/forgotten': [orphan]
      },
      public: {}
    })

    return {dir, helper, orphan}
  }

  it('drops a build helper quietly and keeps a file nothing names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {dir, orphan} = tooling()

    const compiler = {options: {context: dir}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.scripts?.['scripts/replace_browser']).toBeUndefined()
    expect(data.scripts?.['scripts/forgotten']).toEqual([orphan])
    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    warn.mockRestore()
    log.mockRestore()
  })

  it('names the dropped helper on one debug line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const previous = process.env.EXTENSION_DEBUG
    process.env.EXTENSION_DEBUG = 'true'
    const {dir} = tooling()

    try {
      const compiler = {options: {context: dir}} as any
      getSpecialFoldersDataForCompiler(compiler)
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_DEBUG')
      } else {
        process.env.EXTENSION_DEBUG = previous
      }
    }

    const printed = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(log).toHaveBeenCalledTimes(1)
    expect(printed).toContain('scripts/replace_browser.js')
    expect(printed).toContain('package.json script')
    expect(printed).not.toContain('scripts/forgotten.js')
    log.mockRestore()
  })

  it('keeps a build helper the extension references', () => {
    const {dir, helper} = tooling({
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['scripts/replace_browser.js']}
      ]
    })

    const compiler = {options: {context: dir}} as any
    const data = getSpecialFoldersDataForCompiler(compiler)

    expect(data.scripts?.['scripts/replace_browser']).toEqual([helper])
  })
})

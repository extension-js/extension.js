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

  it('drops scripts/ files the extension never references, keeps referenced ones (G13 gap)', () => {
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
    expect(data.scripts?.['scripts/cell']).toBeUndefined()
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

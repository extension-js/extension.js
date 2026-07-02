import {describe, it, expect, vi, afterEach} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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
    fs.writeFileSync(importsBuiltin, "import {readFile} from 'node:fs/promises'\n", 'utf8')
    fs.writeFileSync(contentScript, "document.body.dataset.ok = '1'\n", 'utf8')
    // A browser-safe npm import must NOT be treated as Node tooling.
    fs.writeFileSync(browserImport, "import merge from 'lodash/merge'\n", 'utf8')

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

    // Node tooling removed…
    expect(data.scripts?.['scripts/build-flow-scanner']).toBeUndefined()
    expect(data.scripts?.['scripts/release-build']).toBeUndefined()
    expect(data.scripts?.['scripts/sync']).toBeUndefined()
    // …real content scripts (incl. browser-safe npm imports) kept.
    expect(data.scripts?.['scripts/content']).toEqual([contentScript])
    expect(data.scripts?.['scripts/widget']).toEqual([browserImport])
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

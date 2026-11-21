import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {writeProjectFiles} from '../../__spec__/helpers/extension-project'
import {rememberSpecialFoldersConfig} from '../../lib/special-folders/folders-config'
import {
  getSpecialFoldersDataForCompiler,
  getSpecialFoldersDataForProjectRoot,
  type ScanSpecialFolders
} from '../get-data'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()

  for (const dir of tempDirs.splice(0)) {
    rememberSpecialFoldersConfig(dir, undefined)
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

// A project on disk, read by the real scanner.
function project(files: Record<string, string>): string {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-get-data-'))
  )
  tempDirs.push(root)

  writeProjectFiles(root, files)

  return root
}

const scanOf = (root: string) =>
  getSpecialFoldersDataForCompiler({options: {context: root}} as never)

const at = (root: string, relative: string) =>
  path.join(root, ...relative.split('/'))

describe('getSpecialFoldersDataForCompiler on a real project', () => {
  it('returns the pages, the scripts and the companion folder default', () => {
    const root = project({
      'pages/index.html': '<html></html>',
      'pages/nested/index.html': '<html></html>',
      'pages/readme.md': 'not a page',
      'scripts/content.ts': 'export {}',
      'scripts/data.json': '{}'
    })

    const data = scanOf(root)

    expect(data.pages).toEqual({
      'pages/index': at(root, 'pages/index.html'),
      'pages/nested': at(root, 'pages/nested/index.html')
    })

    expect(data.scripts).toEqual({
      'scripts/content': at(root, 'scripts/content.ts')
    })
  })

  it('keeps a configured public folder inside pages/ and scripts/ out of the entries', () => {
    const root = project({
      'pages/a.html': '<html></html>',
      'pages/static/b.html': '<html></html>',
      'scripts/a.js': 'document.title = "a"',
      'scripts/static/vendor.js': 'document.title = "v"'
    })

    rememberSpecialFoldersConfig(root, {public: 'pages/static'})
    expect(Object.keys(scanOf(root).pages || {})).toEqual(['pages/a'])

    rememberSpecialFoldersConfig(root, {public: 'scripts/static'})
    expect(Object.keys(scanOf(root).scripts || {})).toEqual(['scripts/a'])
  })

  it.each([
    ['a node shebang', 'build-flow-scanner.js', '#!/usr/bin/env node\n'],
    [
      'a Node build tool',
      'release-build.js',
      "const fx = require('fs-extra'); const z = require('zip-dir');\n"
    ],
    [
      'a node: builtin',
      'sync.mjs',
      "import {readFile} from 'node:fs/promises'\n"
    ],
    ['a bare builtin subpath', 'paths.js', "import {join} from 'fs/promises'\n"]
  ])('drops a scripts/ file that imports %s', (_label, name, source) => {
    const root = project({
      [`scripts/${name}`]: source,
      'scripts/content.js': "document.body.dataset.ok = '1'\n",
      'scripts/widget.js': "import merge from 'lodash/merge'\n"
    })

    expect(Object.keys(scanOf(root).scripts || {}).sort()).toEqual([
      'scripts/content',
      'scripts/widget'
    ])
  })

  it('drops a scripts/ file that reaches a Node builtin through a sibling', () => {
    const root = project({
      'scripts/lib/helper.js': "export {default as proc} from 'node:process'\n",
      'scripts/tooling.js':
        "import {proc} from './lib/helper'\nconsole.log(proc.cwd())\n",
      'scripts/loop.js': "import './loop.js'\nimport './widget.js'\n",
      'scripts/widget.js': "import './loop.js'\ndocument.title = 'w'\n"
    })

    expect(scanOf(root).scripts).toEqual({
      'scripts/loop': at(root, 'scripts/loop.js'),
      'scripts/widget': at(root, 'scripts/widget.js')
    })
  })

  it('keeps a scripts/ file nothing references next to the referenced ones', () => {
    const root = project({
      'scripts/content.js': "document.title = 'ok'\n",
      'scripts/injected.js': "console.log('injected')\n",
      'scripts/cell.js': 'data = {cell: 1}\nawait Promise.resolve()\n',
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        content_scripts: [{matches: ['<all_urls>'], js: ['scripts/content.js']}]
      }),
      'background.js':
        "chrome.scripting.executeScript({files: ['/scripts/injected.js']})\n"
    })

    expect(Object.keys(scanOf(root).scripts || {}).sort()).toEqual([
      'scripts/cell',
      'scripts/content',
      'scripts/injected'
    ])
  })

  it('keeps a scripts/ file nothing names and prints nothing about it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = project({
      'scripts/never-mentioned.js': "console.log('orphan')\n",
      'manifest.json': JSON.stringify({manifest_version: 3})
    })

    expect(scanOf(root).scripts).toEqual({
      'scripts/never-mentioned': at(root, 'scripts/never-mentioned.js')
    })

    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  // A TS entry is injected by its emitted `.js` name, never by the `.ts`
  // source path, so the source spelling alone would drop it.
  it('keeps a compiled scripts/ entry a package.json script runs, referenced by its .js name', () => {
    const root = project({
      'scripts/logger-client.ts': 'export const client = 1\n',
      'package.json': JSON.stringify({
        scripts: {watch: 'tsx scripts/logger-client.ts'}
      }),
      'manifest.json': JSON.stringify({
        manifest_version: 3,
        web_accessible_resources: [
          {resources: ['scripts/logger-client.js'], matches: ['<all_urls>']}
        ]
      })
    })

    expect(scanOf(root).scripts).toEqual({
      'scripts/logger-client': at(root, 'scripts/logger-client.ts')
    })
  })

  it('keeps every scripts/ entry when no reference file is readable (fail open)', () => {
    const root = project({
      'scripts/a.js': "console.log('a')\n",
      'package.json': JSON.stringify({scripts: {a: 'node scripts/a.js'}})
    })

    expect(scanOf(root).scripts).toEqual({
      'scripts/a': at(root, 'scripts/a.js')
    })
  })
})

describe('scripts/ entries the package.json scripts run', () => {
  function tooling(
    manifest: Record<string, unknown> = {manifest_version: 3},
    helperName = 'replace_browser'
  ) {
    const root = project({
      [`scripts/${helperName}.js`]: "console.log('helper')\n",
      'scripts/forgotten.js': "console.log('orphan')\n",
      'package.json': JSON.stringify({
        name: 'tooling',
        scripts: {'build:firefox': `node scripts/${helperName}.js firefox`}
      }),
      'manifest.json': JSON.stringify(manifest)
    })

    return {
      root,
      helper: at(root, `scripts/${helperName}.js`),
      orphan: at(root, 'scripts/forgotten.js')
    }
  }

  it('drops a build helper quietly and keeps a file nothing names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {root, orphan} = tooling()

    expect(scanOf(root).scripts).toEqual({'scripts/forgotten': orphan})
    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('names the dropped helper on one debug line', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('EXTENSION_DEBUG', 'true')
    const {root} = tooling()

    scanOf(root)

    const printed = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(log).toHaveBeenCalledTimes(1)
    expect(printed).toContain('scripts/replace_browser.js')
    expect(printed).toContain('package.json script')
    expect(printed).not.toContain('scripts/forgotten.js')
  })

  it('prints the debug line once however many times a build scans the folder', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubEnv('EXTENSION_DEBUG', 'true')
    const {root} = tooling({manifest_version: 3}, 'bump_version')

    scanOf(root)
    scanOf(root)
    scanOf(root)

    const mentions = log.mock.calls.filter((call) =>
      String(call[0]).includes('scripts/bump_version.js')
    )
    expect(mentions).toHaveLength(1)
  })

  it('keeps a build helper the extension references', () => {
    const {root, helper} = tooling({
      manifest_version: 3,
      content_scripts: [
        {matches: ['<all_urls>'], js: ['scripts/replace_browser.js']}
      ]
    })

    expect(scanOf(root).scripts?.['scripts/replace_browser']).toBe(helper)
  })
})

describe('the scan seam', () => {
  it('reads each entry folder through the injected scan, once per folder', () => {
    const root = project({'src/pages/a.html': '<html></html>'})
    const calls: string[] = []
    const page = path.join(root, 'src', 'pages', 'a.html')

    const data = getSpecialFoldersDataForProjectRoot(
      root,
      {pages: 'src/pages'},
      'development',
      {
        scan: (folder, dir): ReturnType<ScanSpecialFolders> => {
          calls.push(`${folder} ${dir}`)

          return folder === 'pages' ? {'pages/a': page} : {}
        }
      }
    )

    expect(calls).toEqual([
      `pages ${path.join(root, 'src', 'pages')}`,
      `scripts ${path.join(root, 'scripts')}`
    ])

    expect(data.pages).toEqual({'pages/a': page})
  })

  // The real scanner returns absolute strings only. These shapes, a relative
  // path and a list per key, reach the filters through other callers.
  it('drops public entries spelled relative or listed per key', () => {
    const root = project({
      'pages/a.html': '<html></html>',
      'public/sample/b.html': '<html></html>',
      'scripts/a.js': 'document.title = "a"',
      'scripts/b.js': 'document.title = "b"',
      'public/sample/b.js': 'document.title = "b"'
    })

    const data = getSpecialFoldersDataForProjectRoot(root, {}, undefined, {
      scan: (folder) =>
        folder === 'pages'
          ? {
              'page-a': path.join(root, 'pages', 'a.html'),
              'page-b': path.join(root, 'public', 'sample', 'b.html'),
              'page-c': 'public/sample/c.html',
              'page-d': 'pages/d.html'
            }
          : ({
              'scripts/a': [
                path.join(root, 'scripts', 'a.js'),
                path.join(root, 'public', 'sample', 'b.js'),
                'public/sample/c.js'
              ],
              'scripts/b': [path.join(root, 'scripts', 'b.js')]
            } as unknown as Record<string, string>)
    })

    expect(data.pages).toEqual({
      'page-a': path.join(root, 'pages', 'a.html'),
      'page-d': 'pages/d.html'
    })

    expect(data.scripts).toEqual({
      'scripts/a': [path.join(root, 'scripts', 'a.js')],
      'scripts/b': [path.join(root, 'scripts', 'b.js')]
    })
  })
})

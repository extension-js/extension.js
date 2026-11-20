import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {type Compiler, rspack} from '@rspack/core'
import {afterAll, describe, expect, it} from 'vitest'
import {extendHtmlPages, type HtmlPage} from '../../shared/html-page-extensions'
import {HtmlPlugin} from '../index'

// The HTML feature emits pages and their assets, the same in every mode.
// What a dev session adds to a page belongs to plugin-reload, and running a
// browser belongs to plugin-browsers.
const FOLDER = path.resolve(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return entry.name === '__spec__' ? [] : sourceFiles(full)
    }

    return /\.(?:ts|js|mjs)$/.test(entry.name) ? [full] : []
  })
}

describe('what the HTML feature knows about reloading and browsers', () => {
  const files = sourceFiles(FOLDER).map((file) => ({
    file: path.relative(FOLDER, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8')
  }))
  const matching = (pattern: RegExp) =>
    files.filter(({text}) => pattern.test(text)).map(({file}) => file)

  it('reads its own source files', () => {
    expect(files.map(({file}) => file)).toEqual(
      expect.arrayContaining([
        'index.ts',
        'steps/emit-html-file.ts',
        'html-lib/patch-html.ts'
      ])
    )
  })

  it('imports nothing from plugin-reload', () => {
    expect(
      matching(/(?:from|import|require\()\s*\(?["'][^"']*plugin-reload/)
    ).toEqual([])
  })

  it('imports nothing from plugin-browsers', () => {
    expect(
      matching(/(?:from|import|require\()\s*\(?["'][^"']*plugin-browsers/)
    ).toEqual([])
  })

  it('reaches the dev server only to ask for a restart', () => {
    const fromDevServer = /["']([^"']*dev-server\/[^"']*)["']/g
    const reached = new Set(
      files.flatMap(({text}) =>
        [...text.matchAll(fromDevServer)].map(
          ([, specifier]) => specifier.split('/').pop() as string
        )
      )
    )

    expect([...reached].sort()).toEqual(['session-restart'])
  })

  it('names no hot update, refresh or reload, in code or comments', () => {
    expect(
      matching(
        /\bhmr\b|\bhot\b|webpackHot|hot-update|\$Refresh|refresh-shim|live-?reload|\breload/i
      )
    ).toEqual([])
  })

  it('names none of the files a dev session adds to a page', () => {
    expect(
      matching(
        /minimum-script-file|preact-refresh|ensure-hmr|dev-server-client-import|getDevServerHmrImports/
      )
    ).toEqual([])
  })

  it('reads neither the build mode nor the session to decide what a page gets', () => {
    expect(
      matching(/options\??\.mode\b|\bdevSession\b|isReloadSession/)
    ).toEqual([])
  })

  // The socket class a dev session swaps into a page sits in this folder,
  // and plugin-reload is the one that wires it in.
  it('holds one dev client file, which nothing in the folder imports', () => {
    expect(matching(/\bWebSocket\b/)).toEqual(['steps/page-socket-client.ts'])
    expect(matching(/["'][^"']*page-socket-client["']/)).toEqual([])
  })

  it('launches and drives no browser', () => {
    expect(
      matching(
        /\bCDP\b|\bRDP\b|remote-debugging|user-data-dir|\bprofile\b|playwright|puppeteer|child_process|\bspawn\(/i
      )
    ).toEqual([])
  })

  it('hands its pages over at one place', () => {
    expect(matching(/htmlPagesExtensionsFor/)).toEqual(['index.ts'])
  })
})

describe('what the HTML feature tells a plugin about its pages', () => {
  const roots: string[] = []
  const compilers: Compiler[] = []

  afterAll(async () => {
    for (const compiler of compilers) {
      await new Promise((resolve) => compiler.close(() => resolve(null)))
    }

    for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
  })

  function project() {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-html-boundary-'))
    )

    roots.push(root)
    fs.writeFileSync(path.join(root, 'manifest.json'), '{}')
    fs.writeFileSync(path.join(root, 'popup.js'), 'console.log(1)\n')
    fs.writeFileSync(
      path.join(root, 'popup.html'),
      '<!doctype html><html><body><script src="./popup.js"></script>' +
        '<script src="https://example.com/remote.js"></script></body></html>'
    )

    fs.writeFileSync(
      path.join(root, 'bare.html'),
      '<!doctype html><html><body></body></html>'
    )

    return root
  }

  function declare(mode: 'development' | 'production', extend: boolean) {
    const root = project()
    const compiler = rspack({mode, context: root, entry: {}})
    const told: Array<readonly HtmlPage[]> = []
    const rulesBefore = compiler.options.module.rules.length

    compilers.push(compiler)

    if (extend) {
      extendHtmlPages(compiler, {
        pagesDeclared: (_compiler, pages) => told.push(pages)
      })
    }

    new HtmlPlugin({
      manifestPath: path.join(root, 'manifest.json'),
      browser: 'chrome',
      includeList: {
        'action/index': path.join(root, 'popup.html'),
        'pages/bare': path.join(root, 'bare.html'),
        'pages/missing': path.join(root, 'missing.html')
      }
    }).apply(compiler)

    return {
      root,
      told,
      entry: compiler.options.entry,
      rulesAdded: compiler.options.module.rules.length - rulesBefore,
      alias: compiler.options.resolve.alias
    }
  }

  it('names each page that got an entry, once, with the scripts it names', () => {
    const {root, told} = declare('development', true)

    expect(told).toEqual([
      [
        {
          entry: 'action/index',
          file: path.join(root, 'popup.html'),
          scripts: [path.join(root, 'popup.js')]
        },
        {entry: 'pages/bare', file: path.join(root, 'bare.html'), scripts: []}
      ]
    ])
  })

  it('declares the same entries, rules and aliases in development as in production', () => {
    const relative = (build: ReturnType<typeof declare>) =>
      JSON.parse(
        JSON.stringify({
          entry: build.entry,
          rulesAdded: build.rulesAdded,
          alias: build.alias
        })
          .split(JSON.stringify(build.root).slice(1, -1))
          .join('<root>')
      )
    const development = relative(declare('development', false))

    expect(development).toEqual(relative(declare('production', false)))
    expect(development.rulesAdded).toBe(0)
    expect(development.entry['action/index'].import).toEqual([
      '<root>/popup.js'
    ])

    expect(development.entry['pages/bare'].import).toEqual([])
  })
})

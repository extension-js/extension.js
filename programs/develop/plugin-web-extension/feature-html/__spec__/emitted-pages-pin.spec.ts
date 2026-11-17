import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {openDevWatchSession} from '../../../__spec__/helpers/dev-watch-session'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'

// Real builds of a project with two pages. The pages a build ships are read
// from the output folder, and a plugin the project adds records the markup
// it is handed at each asset stage, the way a markup minifier would read it.
const tempFolder = trackTempFolders()

const popup =
  '<!doctype html><html><head><title>Popup</title><link rel="stylesheet" href="./style.css"></head><body><h1>Popup</h1><img src="./logo.png"><img src="/shared.png"><script src="./main.js"></script></body></html>\n'
const options =
  '<!doctype html><html><head><title>Options</title></head><body><h1>Options</h1><script src="./options.js"></script></body></html>\n'

// Appends one line per asset stage with the page markup a tap at that stage
// reads. Registered at the stage itself, after the build's own plugins.
const probe = `
const fs = require('node:fs')
const path = require('node:path')
const STAGES = [
  'ADDITIONS',
  'OPTIMIZE',
  'OPTIMIZE_SIZE',
  'DEV_TOOLING',
  'OPTIMIZE_INLINE',
  'SUMMARIZE',
  'OPTIMIZE_HASH',
  'OPTIMIZE_TRANSFER',
  'REPORT'
]
let compiles = 0

module.exports = function probe(compiler) {
  const {Compilation} = compiler.rspack || compiler.webpack
  compiler.hooks.thisCompilation.tap('spec-page-probe', (compilation) => {
    const compile = ++compiles
    for (const stage of STAGES) {
      compilation.hooks.processAssets.tap(
        {name: 'spec-page-probe', stage: Compilation['PROCESS_ASSETS_STAGE_' + stage]},
        () => {
          const asset = compilation.getAsset('action/index.html')
          fs.appendFileSync(
            path.join(__dirname, 'probe.jsonl'),
            JSON.stringify({
              compile,
              stage,
              markup: asset ? String(asset.source.source()) : null
            }) + '\\n'
          )
        }
      )
    }
  })
}
`

const config = `
module.exports = {
  config: (config) => {
    config.plugins.push({apply: require('./probe.cjs')})
    return config
  }
}
`

function project(): string {
  const root = fs.realpathSync(tempFolder('extjs-pages-pin-'))

  const write = (name: string, contents: string | Buffer) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true})
    fs.writeFileSync(path.join(root, name), contents)
  }

  write(
    'package.json',
    JSON.stringify({private: true, name: 'pages-pin', version: '0.0.0'})
  )

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'Pages pin',
      version: '1.0.0',
      action: {default_popup: 'popup/index.html'},
      options_ui: {page: 'options/index.html'}
    })
  )

  write('popup/index.html', popup)
  write('popup/style.css', 'body{color:red}\n')
  write('popup/main.js', "console.log('popup')\n")
  write('popup/logo.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]))
  write('public/shared.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2]))
  write('options/index.html', options)
  write('options/options.js', "console.log('options')\n")
  write('probe.cjs', probe)
  write('extension.config.js', config)

  return root
}

function pagesIn(distPath: string, prefix = ''): Record<string, string> {
  const pages: Record<string, string> = {}

  for (const entry of fs.readdirSync(path.join(distPath, prefix), {
    withFileTypes: true
  })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.isDirectory()) Object.assign(pages, pagesIn(distPath, rel))
    else if (rel.endsWith('.html')) {
      pages[rel] = fs.readFileSync(path.join(distPath, rel), 'utf8')
    }
  }

  return pages
}

// What the probe read in the first compile, as `source` for the file the
// author wrote, `shipped` for the file in the output, or `other`.
function stagesSeen(root: string, shipped: string) {
  const seen: Record<string, string> = {}
  const lines = fs
    .readFileSync(path.join(root, 'probe.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

  for (const line of lines) {
    if (line.compile !== 1) continue

    seen[line.stage] =
      line.markup === popup
        ? 'source'
        : line.markup === shipped
          ? 'shipped'
          : 'other'
  }

  return seen
}

async function productionBuild() {
  const root = project()
  const {extensionBuild} = await import('../../../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    const summary = await extensionBuild(root, {
      browser: 'chrome',
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

  const pages = pagesIn(path.join(root, 'dist', 'chrome'))

  return {pages, seen: stagesSeen(root, pages['action/index.html'])}
}

async function devBuild() {
  const root = project()
  const session = await openDevWatchSession(root, 'chrome', (compiler) => {
    // The watch helper builds its config without the project's config file.
    require(path.join(root, 'probe.cjs'))(compiler)
  })

  try {
    await session.settle()

    const pages = pagesIn(session.distPath)

    return {pages, seen: stagesSeen(root, pages['action/index.html'])}
  } finally {
    await session.close()
  }
}

// The rewrite to output paths lands at the summarize stage, so a plugin
// that reads markup before it, a minifier included, is handed the source.
const markupByStage = {
  ADDITIONS: 'source',
  OPTIMIZE: 'source',
  OPTIMIZE_SIZE: 'source',
  DEV_TOOLING: 'source',
  OPTIMIZE_INLINE: 'source',
  SUMMARIZE: 'shipped',
  OPTIMIZE_HASH: 'shipped',
  OPTIMIZE_TRANSFER: 'shipped',
  REPORT: 'shipped'
}

describe('the pages a build ships', () => {
  it('production', async () => {
    const {pages, seen} = await productionBuild()

    expect(pages).toEqual({
      'action/index.html':
        '<!DOCTYPE html><html><head><title>Popup</title><link rel="stylesheet" href="/action/index.css"></head><body><h1>Popup</h1><img src="/assets/logo.1d636888.png"><img src="/shared.png"><script src="/action/index.js"></script>\n</body></html>',
      'options/index.html':
        '<!DOCTYPE html><html><head><link rel="stylesheet" href="/options/dialog-floor.css" data-extension-js="options-dialog-floor"><title>Options</title></head><body><h1>Options</h1><script src="/options/index.js"></script>\n</body></html>'
    })

    expect(seen).toEqual(markupByStage)
  }, 120000)

  it('development', async () => {
    const {pages, seen} = await devBuild()

    expect(pages).toEqual({
      'action/index.html':
        '<!DOCTYPE html><html><head><title>Popup</title><link rel="stylesheet" href="/action/index.css"></head><body><h1>Popup</h1><img src="/assets/logo.1d636888.png"><img src="/shared.png"><script src="/shared/commons.js"></script><script src="/action/index.js"></script>\n</body></html>',
      'options/index.html':
        '<!DOCTYPE html><html><head><link rel="stylesheet" href="/options/dialog-floor.css" data-extension-js="options-dialog-floor"><title>Options</title></head><body><h1>Options</h1><script src="/shared/commons.js"></script><script src="/options/index.js"></script>\n</body></html>'
    })

    expect(seen).toEqual(markupByStage)
  }, 120000)
})

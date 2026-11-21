import * as fs from 'node:fs'
import * as path from 'node:path'
import {rspack, type Stats} from '@rspack/core'
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {resolveDevelopDistFile} from '../../lib/develop-context'
import {diagnosticCode} from '../../lib/diagnostic-code'
import {getProjectStructure} from '../../lib/project'
import webpackConfig from '../../rspack-config'
import {closeCompiler, cssProjects} from './helpers/css-project'

const makeProject = cssProjects()

const HINT = 'Set EXTENSION_STRICT_REFS=true to make this a build error.'

afterEach(() => {
  vi.unstubAllEnvs()
})

function manifest(extra: Record<string, unknown>) {
  return JSON.stringify({
    manifest_version: 3,
    name: 'strict-refs',
    version: '1.0.0',
    ...extra
  })
}

const page = (head: string, body: string) =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`

// Every way a stylesheet reaches a build: each takes its own rule or hook.
const SHEETS: Record<string, (css: string) => Record<string, string>> = {
  'a content script imports': (css) => ({
    'manifest.json': manifest({
      content_scripts: [{matches: ['<all_urls>'], js: ['content/scripts.js']}]
    }),
    'content/scripts.js': 'import "./styles.css"\n',
    'content/styles.css': css
  }),
  'the manifest lists for a content script': (css) => ({
    'manifest.json': manifest({
      content_scripts: [{matches: ['<all_urls>'], css: ['content/styles.css']}]
    }),
    'content/styles.css': css
  }),
  'a page links': (css) => ({
    'manifest.json': manifest({action: {default_popup: 'popup/index.html'}}),
    'popup/index.html': page('<link rel="stylesheet" href="./styles.css">', ''),
    'popup/styles.css': css
  }),
  'a page script imports': (css) => ({
    'manifest.json': manifest({action: {default_popup: 'popup/index.html'}}),
    'popup/index.html': page('', '<script src="./script.js"></script>'),
    'popup/script.js': 'import "./styles.css"\n',
    'popup/styles.css': css
  })
}

const REQUESTS = ['./missing.png', '/img/missing.png']

const CASES = Object.keys(SHEETS).flatMap((sheet) =>
  REQUESTS.map((request) => [sheet, request] as const)
)

// A production build of the whole config, the way `extension build` runs it.
async function findings(sheet: string, request: string) {
  const root = makeProject(SHEETS[sheet](`.a{background:url(${request})}\n`))
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'production',
    metadataCommand: 'build',
    silent: true,
    output: {clean: true, path: path.join(root, 'dist', 'chrome')}
  })

  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-ready-contract'
  )

  config.stats = false

  const compiler = rspack(config)

  try {
    const stats = await new Promise<Stats>((resolve, reject) => {
      compiler.run((error, result) =>
        error || !result ? reject(error) : resolve(result)
      )
    })
    // Name, code, and whether the text tells the reader to set the variable.
    const read = (issues: Error[]) =>
      issues
        .filter((issue) => issue.message.includes('missing.png'))
        .map((issue) =>
          [
            issue.name,
            diagnosticCode(issue),
            ...(issue.message.includes(HINT) ? ['hint'] : [])
          ].join(' ')
        )

    return {
      warnings: read(stats.compilation.warnings),
      errors: read(stats.compilation.errors)
    }
  } finally {
    await closeCompiler(compiler)
  }
}

describe('a dead url() across every kind of stylesheet', () => {
  beforeAll(() => {
    // The rules name the compiled loaders, which only the compile step writes.
    const loader = resolveDevelopDistFile('dead-css-url-loader')

    if (!fs.existsSync(loader)) {
      throw new Error(
        `This spec compiles with the loaders in programs/develop/dist and ${loader} is missing. ` +
          'Run `pnpm --filter extension-develop compile` first.'
      )
    }
  })

  it.each(
    CASES
  )('warns and keeps building for a sheet %s naming %s', async (sheet, request) => {
    vi.stubEnv('EXTENSION_STRICT_REFS', '')

    expect(await findings(sheet, request)).toEqual({
      warnings: ['CssDeadRef E_CSS_DEAD_REF hint'],
      errors: []
    })
  })

  it.each(
    CASES
  )('fails a strict build for a sheet %s naming %s', async (sheet, request) => {
    vi.stubEnv('EXTENSION_STRICT_REFS', 'true')

    expect(await findings(sheet, request)).toEqual({
      warnings: [],
      errors: ['CssDeadRef E_CSS_DEAD_REF']
    })
  })
})

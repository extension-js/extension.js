import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripVTControlCharacters as stripAnsi} from 'node:util'
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
    name: 'import-wording',
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

// Each way an @import names its sheet, and the request it is reported by.
const IMPORTS = [
  ['@import "./missing.css";', './missing.css'],
  ['@import url(./missing.css);', './missing.css'],
  ["@import './missing.css' screen;", './missing.css'],
  ['@import "/css/missing.css";', '/css/missing.css']
] as const

const CASES = Object.keys(SHEETS).flatMap((sheet) =>
  IMPORTS.map(([statement, request]) => [sheet, statement, request] as const)
)

// rspack hands a diagnostic back inside its own frame: a glyph on the first
// line and a bar on the others.
function unframed(message: string) {
  return stripAnsi(message)
    .trimEnd()
    .split('\n')
    .map((line) => line.replace(/^\s*(?:⚠|×|│)\s?/, ''))
    .join('\n')
}

const wording = (issuer: string, request: string, strict: boolean) =>
  [
    `An @import "${request}" names a stylesheet that exists nowhere in the project.`,
    `PATH ${issuer}`,
    `NOT FOUND ${request}`,
    'Chrome applies the rest of the stylesheet and skips this import silently, so the rules it names never load.',
    ...(strict ? [] : [HINT])
  ].join('\n')

// A production build of the whole config, the way `extension build` runs it.
async function findings(sheet: string, statement: string) {
  const root = makeProject(SHEETS[sheet](`${statement}\n.a{color:red}\n`))
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
    const read = (issues: Error[]) =>
      issues
        .filter((issue) => issue.message.includes('missing.css'))
        .map((issue) => [
          issue.name,
          diagnosticCode(issue),
          unframed(issue.message)
        ])

    return {
      warnings: read(stats.compilation.warnings),
      errors: read(stats.compilation.errors)
    }
  } finally {
    await closeCompiler(compiler)
  }
}

describe('an @import of a stylesheet that is not there', () => {
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
  )('is reported as an import for a sheet %s holding %s', async (sheet, statement, request) => {
    vi.stubEnv('EXTENSION_STRICT_REFS', '')

    const issuer = sheet.includes('page')
      ? 'popup/styles.css'
      : 'content/styles.css'

    expect(await findings(sheet, statement)).toEqual({
      warnings: [
        ['CssDeadRef', 'E_CSS_DEAD_REF', wording(issuer, request, false)]
      ],
      errors: []
    })
  })

  it.each(
    Object.keys(SHEETS)
  )('fails a strict build in the same words for a sheet %s', async (sheet) => {
    vi.stubEnv('EXTENSION_STRICT_REFS', 'true')

    const issuer = sheet.includes('page')
      ? 'popup/styles.css'
      : 'content/styles.css'

    expect(await findings(sheet, '@import "./missing.css";')).toEqual({
      warnings: [],
      errors: [
        ['CssDeadRef', 'E_CSS_DEAD_REF', wording(issuer, './missing.css', true)]
      ]
    })
  })
})

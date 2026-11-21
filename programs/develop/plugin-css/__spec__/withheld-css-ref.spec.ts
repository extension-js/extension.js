import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {withheldCssRefs} from '../../lib/withheld-file'
import {cssProjects, expectNoWorkspaceAbove} from './helpers/css-project'
import {buildProject} from '../../__spec__/helpers/build-project'

const makeProject = cssProjects()
const CAPTURED = '__extjsWithheldCssRefSpecCompilation'

afterEach(() => {
  vi.unstubAllEnvs()
  delete (globalThis as Record<string, unknown>)[CAPTURED]
})

type Route = 'content' | 'page' | 'listed'

// Hands the spec the compilation a build ran, which no result carries.
const CAPTURE_CONFIG = [
  'module.exports = {',
  '  config: (config) => {',
  '    config.plugins.push({apply(compiler) {',
  `      compiler.hooks.done.tap('capture', (stats) => { globalThis.${CAPTURED} = stats.compilation })`,
  '    }})',
  '    return config',
  '  }',
  '}',
  ''
].join('\n')

// Fakes: no file here holds a real value.
const SHEET = [
  '@import url(./.env);',
  '.a{background:url(./.npmrc)}',
  '.b{background:url(../../shared/outside.png)}',
  '.c{background:url(./gone.png)}',
  ''
].join('\n')

function project(folder: Route) {
  const root = makeProject({
    'app/package.json': JSON.stringify({
      private: true,
      name: 'withheld-wording',
      version: '0.0.0'
    }),
    'app/manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'withheld-wording',
      version: '1.0.0',
      action: {default_popup: 'page/popup.html'},
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: [`${folder}/scripts.js`],
          ...(folder === 'listed' ? {css: ['listed/styles.css']} : {})
        }
      ]
    }),
    'app/extension.config.js': CAPTURE_CONFIG,
    [`app/${folder}/scripts.js`]:
      folder === 'content'
        ? "import href from './styles.css'\ndocument.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}))\n"
        : 'document.title = "x"\n',
    'app/page/popup.html': `<!doctype html>${folder === 'page' ? '<link rel="stylesheet" href="./styles.css">' : ''}<p>x</p>\n`,
    [`app/${folder}/styles.css`]: SHEET,
    [`app/${folder}/.env`]: 'FAKE_MARKER_ENV=one\n',
    [`app/${folder}/.npmrc`]: 'FAKE_MARKER_NPMRC=two\n',
    'shared/outside.png': 'FAKE_MARKER_OUTSIDE\n'
  })
  const app = path.join(root, 'app')

  expectNoWorkspaceAbove(app)

  return app
}

interface Finding {
  code?: string
  name?: string
  file?: string
  message: string
}

async function build(app: string) {
  try {
    const summary = (await buildProject(app, {
      mode: 'production',
      exitOnError: false
    })) as {errors_count: number; warnings?: string[]}

    return {summary, failed: undefined}
  } catch (error) {
    const failed = (error as {diagnostics?: Finding[]}).diagnostics
    if (!Array.isArray(failed)) throw error

    return {summary: undefined, failed}
  }
}

// A summary line as written, without the frame the bundler draws around it.
const plain = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:⚠|×|│)\s?/, ''))
    .join('\n')

const PRIVATE_WHY =
  'The build never bundles env files, tooling files or repository files. Move the contents into a file with another name.'
const OUTSIDE_WHY =
  'The file is not one the project or its workspace shares. Move it into the project.'

const said = (request: string, why: string, sheet: string, strict = false) =>
  [
    `${request} is not bundled. Check the url() or @import that names it in this stylesheet.`,
    why,
    `PATH ${sheet}`,
    'The rest of the stylesheet ships, and this reference loads nothing.',
    ...(strict
      ? []
      : ['Set EXTENSION_STRICT_REFS=true to make this a build error.'])
  ].join('\n')

const ROUTES: Array<[string, Route]> = [
  ['a content script sheet', 'content'],
  ['a page sheet', 'page'],
  ['a sheet the manifest lists', 'listed']
]

// One sheet names a private sheet by @import, a private file and a file from
// outside by url(), and a file that is not there. Each route says the same.
describe('a stylesheet reference to a file the build withholds, built', () => {
  it.each(ROUTES)(
    '%s says it is not bundled, under one code, an @import like a url()',
    async (_label, folder) => {
      const app = project(folder)
      const sheet = `${folder}/styles.css`
      const {summary} = await build(app)
      const warnings = (summary?.warnings || []).map(plain)

      expect(summary?.errors_count).toBe(0)
      expect(
        warnings.filter((warning) => warning.includes('is not bundled')).sort()
      ).toEqual(
        [
          `W_CSS_DEAD_REF: ${said('./.env', PRIVATE_WHY, sheet)}`,
          `W_CSS_DEAD_REF: ${said('./.npmrc', PRIVATE_WHY, sheet)}`,
          `W_CSS_DEAD_REF: ${said('../../shared/outside.png', OUTSIDE_WHY, sheet)}`
        ].sort()
      )

      // Only the file that is not there reads as one that is not there.
      expect(
        warnings
          .map(
            (warning) => /A url\((\S+)\) reference points/.exec(warning)?.[1]
          )
          .filter(Boolean)
      ).toEqual(['./gone.png'])

      const all = warnings.join('\n')

      expect(all).not.toContain('keeps private')
      expect(all).not.toContain("Couldn't bring an @import")
      expect(all).not.toContain('FAKE_MARKER')
    },
    120_000
  )

  it.each(ROUTES)(
    '%s leaves the sheet and each reference to read by field',
    async (_label, folder) => {
      const app = project(folder)
      const sheet = `${folder}/styles.css`

      await build(app)

      const compilation = (globalThis as Record<string, unknown>)[CAPTURED] as {
        warnings: Array<{name?: string; file?: string}>
      }
      const byRef = (a: {ref: string}, b: {ref: string}) =>
        a.ref.localeCompare(b.ref)

      expect([...withheldCssRefs(compilation)].sort(byRef)).toEqual(
        [
          {name: 'CssWithheldRef', ref: './.env', sheet},
          {name: 'CssWithheldRef', ref: './.npmrc', sheet},
          {name: 'CssWithheldRef', ref: '../../shared/outside.png', sheet}
        ].sort(byRef)
      )

      // The diagnostic itself keeps its name and its sheet through the bundler.
      expect(
        [...compilation.warnings]
          .filter((warning) => warning.name === 'CssWithheldRef')
          .map((warning) => warning.file)
      ).toEqual([sheet, sheet, sheet])
    },
    120_000
  )

  it.each(ROUTES)(
    '%s fails a strict build under the same name and code',
    async (_label, folder) => {
      vi.stubEnv('EXTENSION_STRICT_REFS', 'true')

      const app = project(folder)
      const sheet = `${folder}/styles.css`
      const {failed} = await build(app)

      expect(
        (failed || [])
          .filter((finding) => finding.name === 'CssWithheldRef')
          .map(({code, file, message}) => [code, file, message].join(' | '))
          .sort()
      ).toEqual(
        [
          ['./.env', PRIVATE_WHY],
          ['./.npmrc', PRIVATE_WHY],
          ['../../shared/outside.png', OUTSIDE_WHY]
        ]
          .map(
            ([request, why]) =>
              `E_CSS_DEAD_REF | ${sheet} | ${said(request, why, sheet, true)}`
          )
          .sort()
      )

      expect(fs.existsSync(path.join(app, 'dist', 'chrome'))).toBe(false)
    },
    120_000
  )
})

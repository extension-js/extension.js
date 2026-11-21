import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {rspack} from '@rspack/core'
import {describe, expect, it, vi} from 'vitest'
import {buildProject} from '../../../__spec__/helpers/build-project'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {getProjectStructure} from '../../../lib/project'
import webpackConfig from '../../../rspack-config'

// What a loader added through the config hook of extension.config.js is
// handed for a content script, read from whole builds with a recording loader.
const tempFolder = trackTempFolders()

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

type Language = 'js' | 'ts' | 'jsx' | 'tsx'
type Mode = 'production' | 'development'
type Placement = 'push' | 'unshift' | 'replace' | 'plugin'

const LANGUAGES: Language[] = ['js', 'ts', 'jsx', 'tsx']
const MODES: Mode[] = ['production', 'development']
const RUN = 'globalThis.ran = (globalThis.ran || 0) + 1'

// The doubled spaces are the tell: the transpiler prints its own spacing.
const AUTHORED: Record<Language, string> = {
  js: `const  spaced = 'as written'\nexport default function main() { ${RUN}; globalThis.said = spaced }\n`,
  ts: `const  spaced: string = 'as written'\nexport default function main(): void { ${RUN}; globalThis.said = spaced }\n`,
  jsx: `const  spaced = 'as written'\nexport default function main() { ${RUN}; globalThis.said = <p title={spaced} /> }\n`,
  tsx: `const  spaced: string = 'as written'\nexport default function main(): void { ${RUN}; globalThis.said = <p title={spaced} /> }\n`
}

const LOADERS = {
  // Records what it was handed and its turn, then signs the text it returns.
  'record-loader.cjs': [
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    'module.exports = function record(source, map) {',
    '  const {label, dir} = this.getOptions()',
    '  fs.mkdirSync(dir, {recursive: true})',
    "  fs.writeFileSync(path.join(dir, label + '.txt'), source)",
    "  fs.appendFileSync(path.join(dir, 'order.txt'), label + ' ')",
    "  this.callback(null, source + '\\n/* seen by ' + label + ' */\\n', map)",
    '}',
    ''
  ].join('\n'),
  // Changes the text the way a transform does, one spelling for another.
  'rewrite-loader.cjs': [
    'module.exports = function rewrite(source) {',
    '  const {from, to} = this.getOptions()',
    '  return source.split(from).join(to)',
    '}',
    ''
  ].join('\n'),
  // Returns a text of its own, as a compiler for another language does.
  'return-loader.cjs': [
    'module.exports = function returned() {',
    '  return this.getOptions().text',
    '}',
    ''
  ].join('\n')
}

const RECORDING_RULES = [
  "record('first')",
  "record('second')",
  "record('pre', 'pre')",
  "record('post', 'post')"
].join(', ')

const PLACEMENTS: Record<Placement, string> = {
  push: `config.module.rules.push(${RECORDING_RULES})`,
  unshift: `config.module.rules.unshift(${RECORDING_RULES})`,
  replace: `config = {...config, module: {...config.module, rules: [${RECORDING_RULES}]}}`,
  // A plugin of the project applies after the build's own, and adds its
  // rules in front of the list then.
  plugin: `config.plugins.push({apply(compiler) { compiler.options.module.rules.unshift(${RECORDING_RULES}) }})`
}

// The hook body is the part a test writes: where its rules go and what they use.
function configFile(body: string) {
  return [
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    "const seen = path.join(__dirname, 'seen')",
    'const MAIN = /content[\\\\/]main\\.[a-z]+$/',
    'const use = (file, options = {}) => [',
    '  {loader: path.join(__dirname, file), options: {dir: seen, ...options}}',
    ']',
    'const record = (label, enforce, test = MAIN) => ({',
    '  test,',
    '  ...(enforce ? {enforce} : {}),',
    "  use: use('record-loader.cjs', {label})",
    '})',
    '// Lists each module with the loaders it went through.',
    'const listModules = {',
    '  apply(compiler) {',
    "    compiler.hooks.done.tap('list-modules', (stats) => {",
    '      const {modules} = stats.toJson({all: false, modules: true})',
    '      fs.mkdirSync(seen, {recursive: true})',
    '      fs.writeFileSync(',
    "        path.join(seen, 'modules.json'),",
    '        JSON.stringify(modules.map((one) => one.identifier))',
    '      )',
    '    })',
    '  }',
    '}',
    'module.exports = {',
    '  config: (config) => {',
    `    ${body}`,
    '    config.plugins.push(listModules)',
    '    return config',
    '  }',
    '}',
    ''
  ].join('\n')
}

// A stand-in JSX runtime, so a JSX content script resolves with no install.
function installReact(root: string) {
  const runtime =
    "export const Fragment = 'Fragment'\n" +
    'export function jsx(type, props) { return {type, props} }\n' +
    'export const jsxs = jsx\n' +
    'export const jsxDEV = jsx\n'

  write(
    root,
    'node_modules/react/package.json',
    JSON.stringify({
      name: 'react',
      version: '18.3.1',
      type: 'module',
      main: './index.js',
      exports: {
        '.': './index.js',
        './jsx-runtime': './jsx-runtime.js',
        './jsx-dev-runtime': './jsx-dev-runtime.js',
        './package.json': './package.json'
      }
    })
  )

  write(
    root,
    'node_modules/react/index.js',
    'export function createElement() {}\n'
  )

  write(root, 'node_modules/react/jsx-runtime.js', runtime)
  write(root, 'node_modules/react/jsx-dev-runtime.js', runtime)
}

interface Fixture {
  // The content scripts of one manifest group, by path, in manifest order.
  scripts: Record<string, string>
  // Any other file of the project.
  files?: Record<string, string>
  // The body of the config hook.
  config: string
}

function project({scripts, files = {}, config}: Fixture) {
  const root = fs.realpathSync(tempFolder('extjs-user-loader-order-'))

  const names = Object.keys(scripts)
  const usesJsx = names.some((name) => name.endsWith('x'))
  const usesTypes = names.some((name) => /\.tsx?$/.test(name))

  if (usesJsx) installReact(root)

  write(
    root,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'user-loader-order',
      version: '0.0.0',
      ...(usesJsx ? {dependencies: {react: '18.3.1'}} : {}),
      ...(usesTypes ? {devDependencies: {typescript: '5.4.5'}} : {})
    })
  )

  if (usesTypes) {
    write(
      root,
      'tsconfig.json',
      JSON.stringify({compilerOptions: {strict: true, jsx: 'preserve'}})
    )
  }

  write(
    root,
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      name: 'user-loader-order',
      version: '1.0.0',
      content_scripts: [{matches: ['<all_urls>'], js: names}]
    })
  )

  for (const [name, text] of Object.entries({
    ...scripts,
    ...files,
    ...LOADERS,
    'extension.config.js': configFile(config)
  })) {
    write(root, name, text)
  }

  return root
}

interface BuildFailure extends Error {
  diagnostics?: Array<{code?: string; message: string; file?: string}>
}

async function build(root: string, mode: Mode) {
  const spies = (['log', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {})
  )

  try {
    return await buildProject(root, {mode, exitOnError: false})
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

async function failure(root: string, mode: Mode): Promise<BuildFailure> {
  return build(root, mode).then(
    () => {
      throw new Error('the build was expected to fail')
    },
    (error: BuildFailure) => error
  )
}

const SIGNATURE = /\n\/\* seen by [a-z]+ \*\/\n/g
const seenText = (root: string, label: string) =>
  fs.readFileSync(path.join(root, 'seen', `${label}.txt`), 'utf8')

// Names the text a loader was handed by what has already happened to it.
function reading(root: string, label: string, authored: string) {
  const text = seenText(root, label)
  const wrapped = text.includes('__EXTENSIONJS_mount(')
  const compiled = !text.includes('const  spaced')
  // The transpiler reprints the wrapper too, when the wrapper ran ahead of it.
  const wrapperReprinted = !text.includes('var __EXTENSIONJS_BUNDLE_KEY="')

  if (text.replace(SIGNATURE, '') === authored) return 'authored'
  if (wrapped && !compiled) return 'wrapped'
  if (wrapped && wrapperReprinted) return 'wrapped, then compiled'
  if (wrapped) return 'compiled, then wrapped'
  if (compiled) return 'compiled'

  return 'something else'
}

const turns = (root: string) =>
  fs.readFileSync(path.join(root, 'seen', 'order.txt'), 'utf8').trim()

const WRAPPER = 'feature-scripts-content-script-wrapper'

// How many times the wrapper is in the loaders of the module of one file.
function wrapperRuns(root: string, file: string) {
  const identifiers = JSON.parse(
    fs.readFileSync(path.join(root, 'seen', 'modules.json'), 'utf8')
  ) as Array<string | null>

  return identifiers
    .map((identifier) => String(identifier))
    .filter((identifier) => identifier.includes(path.join(root, file)))
    .map((identifier) => identifier.split(WRAPPER).length - 1)
}

function emitted(root: string) {
  const dist = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
  )

  return fs.readFileSync(
    path.join(dist, manifest.content_scripts[0].js[0]),
    'utf8'
  )
}

function pageStub(warned: string[] = []) {
  const page: Record<string, unknown> = {
    document: {
      readyState: 'complete',
      addEventListener() {},
      removeEventListener() {}
    },
    console: {
      log() {},
      warn: (...parts: unknown[]) => warned.push(parts.map(String).join(' ')),
      error() {}
    },
    setTimeout,
    clearTimeout,
    queueMicrotask
  }
  page.globalThis = page
  page.window = page
  page.self = page

  return page
}

// Runs the emitted content script on a page stub, the way a browser injects
// it once, and reports what the page saw.
function inject(root: string) {
  const warned: string[] = []
  const page = pageStub(warned)

  vm.runInNewContext(emitted(root), page)

  return {mounts: Number(page.ran || 0), said: page.said, warned, page}
}

// The bundle of a dev session, which a build command never makes: the rule
// joins the list where the config hook would have put it.
async function devSessionBundle(root: string, rule: object) {
  const dist = path.join(root, 'dist', 'chrome')
  const config = webpackConfig(await getProjectStructure(root), {
    browser: 'chrome',
    mode: 'development',
    metadataCommand: 'dev',
    silent: true,
    output: {clean: true, path: dist}
  } as Parameters<typeof webpackConfig>[1])

  config.plugins = (config.plugins || []).filter(
    (plugin) =>
      plugin?.constructor.name !== 'plugin-browsers' &&
      plugin?.constructor.name !== 'plugin-playwright'
  )

  config.stats = false
  config.module?.rules?.push(rule)

  const errors = await new Promise<string[]>((resolve, reject) => {
    const compiler = rspack(config)

    compiler.run((error, stats) => {
      compiler.close(() => {
        if (error) reject(error)
        else resolve((stats?.compilation.errors || []).map((e) => e.message))
      })
    })
  })
  const scripts = path.join(dist, 'content_scripts')
  const bundle = fs
    .readdirSync(scripts)
    .find((name) => /^content-0\.[a-f0-9]+\.js$/.test(name))

  return {
    errors,
    text: fs.readFileSync(path.join(scripts, String(bundle)), 'utf8')
  }
}

const mainScript = (language: Language) => ({
  [`content/main.${language}`]: AUTHORED[language]
})

async function recorded(language: Language, mode: Mode, placement: Placement) {
  const root = project({
    scripts: mainScript(language),
    config: PLACEMENTS[placement]
  })
  const summary = await build(root, mode)

  expect(summary.errors_count).toBe(0)

  return {
    order: turns(root),
    first: reading(root, 'first', AUTHORED[language]),
    second: reading(root, 'second', AUTHORED[language]),
    pre: reading(root, 'pre', AUTHORED[language]),
    post: reading(root, 'post', AUTHORED[language]),
    wrapperRuns: wrapperRuns(root, `content/main.${language}`),
    mounts: inject(root).mounts
  }
}

// Rules of one enforce class run from the last of the list to the first, so
// the second rule signs the text before the first one reads it.
const HANDED = {
  order: 'pre second first post',
  first: 'authored',
  second: 'authored',
  pre: 'authored',
  post: 'wrapped, then compiled',
  wrapperRuns: [1],
  mounts: 1
}

describe('what a user loader is handed for a content script', () => {
  for (const mode of MODES) {
    for (const language of LANGUAGES) {
      it(`${language} in ${mode}: the file as written, unless the rule is enforce post`, async () => {
        expect(await recorded(language, mode, 'push')).toEqual(HANDED)
      }, 120000)
    }
  }

  for (const placement of ['unshift', 'replace'] as const) {
    for (const mode of MODES) {
      it(`reads the same in ${mode} for rules added by ${placement}`, async () => {
        expect(await recorded('ts', mode, placement)).toEqual(HANDED)
      }, 120000)
    }
  }

  for (const mode of MODES) {
    it(`reads the same in ${mode} for rules a plugin of the project puts in front`, async () => {
      expect(await recorded('ts', mode, 'plugin')).toEqual(HANDED)
    }, 120000)
  }

  it('hands over a getURL import as written, and still keeps it native', async () => {
    const authored =
      `export default function main() { ${RUN} }\n` +
      "globalThis.late = () => import(chrome.runtime.getURL('late.js'))\n"
    const root = project({
      scripts: {'content/main.js': authored},
      files: {'late.js': 'export const late = true\n'},
      config: "config.module.rules.push(record('first'))"
    })

    expect((await build(root, 'production')).errors_count).toBe(0)
    expect(seenText(root, 'first')).toBe(authored)
    expect(emitted(root)).toMatch(
      /import\(chrome\.runtime\.getURL\(["']late\.js["']\)\)/
    )
  }, 120000)
})

describe('a content script a user loader changed', () => {
  for (const mode of MODES) {
    it(`mounts what a loader rewrote in ${mode}`, async () => {
      const root = project({
        scripts: mainScript('ts'),
        config:
          "config.module.rules.push({test: MAIN, use: use('rewrite-loader.cjs', {from: 'as written', to: 'as rewritten'})})"
      })

      expect((await build(root, mode)).errors_count).toBe(0)
      expect(wrapperRuns(root, 'content/main.ts')).toEqual([1])
      expect(inject(root)).toMatchObject({
        mounts: 1,
        said: 'as rewritten',
        warned: []
      })
    }, 120000)
  }

  it('cleans up the copy a dev session replaces, each time it injects again', async () => {
    const root = project({
      scripts: {
        'content/main.ts':
          `const  spaced: string = 'as written'\n` +
          `export default function main(): () => void { ${RUN}; globalThis.said = spaced\n` +
          '  return () => { globalThis.cleaned = (globalThis.cleaned || 0) + 1 }\n' +
          '}\n'
      },
      config: ''
    })
    const {errors, text} = await devSessionBundle(root, {
      test: /content[\\/]main\.ts$/,
      use: [
        {
          loader: path.join(root, 'rewrite-loader.cjs'),
          options: {from: 'as written', to: 'as rewritten'}
        }
      ]
    })
    const page = pageStub()
    const seen: unknown[] = []

    for (let injection = 0; injection < 3; injection++) {
      vm.runInNewContext(text, page)
      seen.push([page.ran, page.cleaned, page.said])
    }

    expect(errors).toEqual([])
    expect(seen).toEqual([
      [1, undefined, 'as rewritten'],
      [2, 1, 'as rewritten'],
      [3, 2, 'as rewritten']
    ])
  }, 120000)

  // Each text is what a loader hands back for a TypeScript file: JavaScript
  // with the default export in another shape than the author wrote.
  const RETURNED: Array<{title: string; text: string; mounts: number}> = [
    {
      title: 'a function declaration',
      text: `export default function main() { ${RUN} }\n`,
      mounts: 1
    },
    {
      title: 'an arrow assigned, then exported',
      text: `const main = () => { ${RUN} }\nexport default main\n`,
      mounts: 1
    },
    {
      title: 'a default named in an export list',
      text: `function main() { ${RUN} }\nexport { main as default }\n`,
      mounts: 1
    },
    {
      title: 'minified text on one line',
      text: `function a(){${RUN}}var b=1;export{a as default,b};`,
      mounts: 1
    },
    // A class cannot be mounted with or without a loader. The page is told.
    {
      title: 'a class',
      text: `export default class Main { constructor() { ${RUN} } }\n`,
      mounts: 0
    }
  ]

  for (const mode of MODES) {
    for (const {title, text, mounts} of RETURNED) {
      it(`reads ${title} a loader returned in ${mode}`, async () => {
        const root = project({
          scripts: mainScript('ts'),
          config: `config.module.rules.push({test: MAIN, use: use('return-loader.cjs', {text: ${JSON.stringify(text)}})})`
        })

        expect((await build(root, mode)).errors_count).toBe(0)

        const page = inject(root)

        expect(page.mounts).toBe(mounts)
        expect(page.warned).toEqual(
          mounts === 1
            ? []
            : [
                expect.stringContaining(
                  'Extension.js: the content script default export failed to run.'
                )
              ]
        )
      }, 120000)
    }
  }
})

// A named refusal prints only its own message, so every line is compared,
// and a loader chain head or a stack coming back fails the rows.
function said(error: BuildFailure) {
  return String(error.diagnostics?.[0].message).split('\n')
}

describe('a user loader that returns no default export', () => {
  const LOST = [
    {
      title: 'a CommonJS export',
      text: `module.exports = function main() { ${RUN} }\n`
    },
    {title: 'no export at all', text: `${RUN}\n`}
  ]

  for (const mode of MODES) {
    for (const {title, text} of LOST) {
      it(`stops the ${mode} build for ${title} and names the file and the loader`, async () => {
        const root = project({
          scripts: mainScript('ts'),
          config: `config.module.rules.push({test: MAIN, use: use('return-loader.cjs', {text: ${JSON.stringify(text)}})})`
        })
        const error = await failure(root, mode)

        expect(error.diagnostics).toHaveLength(1)
        expect(error.diagnostics?.[0].code).toBe('E_CONTENT_SCRIPT_SYNTAX')
        expect(said(error)).toEqual([
          'Extension.js could not find the default export of content/main.ts in what a loader returned.',
          'PATH content/main.ts',
          'LOADERS return-loader.cjs',
          'The file has a default export as written, which is the function the build mounts. The build read the file after the loaders named above, and the text they returned has no default export, so the script would never run.',
          'Keep the default export in what the loaders return, as plain JavaScript, TypeScript or JSX, or narrow their rule so it skips this file.'
        ])
      }, 120000)
    }
  }

  it('says the same of a rule that is enforce pre', async () => {
    const root = project({
      scripts: mainScript('ts'),
      config: `config.module.rules.push({test: MAIN, enforce: 'pre', use: use('return-loader.cjs', {text: ${JSON.stringify(LOST[1].text)}})})`
    })
    const error = await failure(root, 'production')

    expect(error.diagnostics?.[0].code).toBe('E_CONTENT_SCRIPT_SYNTAX')
    expect(error.diagnostics?.[0].message).toContain(
      'LOADERS return-loader.cjs'
    )
  }, 120000)

  it('builds a script that had no default export to lose, and runs it as returned', async () => {
    const root = project({
      scripts: {'content/main.ts': `const  spaced: string = 'as written'\n`},
      config: `config.module.rules.push({test: MAIN, use: use('return-loader.cjs', {text: ${JSON.stringify(LOST[1].text)}})})`
    })

    expect((await build(root, 'production')).errors_count).toBe(0)
    expect(inject(root)).toMatchObject({mounts: 1, warned: []})
  }, 120000)
})

// A name the wrapper writes that a minifier keeps, so it tells a wrapped
// bundle from one whose wrapping the concatenation threw away.
const WRAPPER_GLOBAL = '__EXTENSIONJS_registerCleanup'

describe('content scripts concatenated into one classic module', () => {
  const scripts = {
    'content/a.js': 'var shared = "from a"\n',
    'content/b.js': `${RUN}\nglobalThis.said = shared\n`
  }

  for (const mode of MODES) {
    it(`wraps the module once in ${mode}`, async () => {
      const root = project({scripts, config: ''})

      expect((await build(root, mode)).errors_count).toBe(0)
      expect(wrapperRuns(root, 'content/a.js')).toEqual([1])
      expect(emitted(root)).toContain(WRAPPER_GLOBAL)
      expect(inject(root)).toMatchObject({mounts: 1, said: 'from a'})
    }, 120000)

    it(`hands a user loader the concatenated text before the wrapper in ${mode}`, async () => {
      const root = project({
        scripts,
        config:
          "config.module.rules.push(record('first', undefined, /content[\\\\/]a\\.js$/))"
      })

      expect((await build(root, mode)).errors_count).toBe(0)

      const handed = seenText(root, 'first')

      expect(handed).toContain('var shared = "from a"')
      expect(handed).toContain('globalThis.said = shared')
      expect(handed).not.toContain('__EXTENSIONJS_BUNDLE_KEY')
      expect(wrapperRuns(root, 'content/a.js')).toEqual([1])
      expect(emitted(root)).toContain(WRAPPER_GLOBAL)
      expect(inject(root)).toMatchObject({mounts: 1, said: 'from a'})
    }, 120000)
  }
})

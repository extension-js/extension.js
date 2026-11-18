import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterAll, describe, expect, it} from 'vitest'

// What a loader added through the config hook of extension.config.js is
// handed for a content script, read from whole builds with a recording loader.
const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function write(root: string, rel: string, content: string) {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

type Language = 'js' | 'ts' | 'jsx' | 'tsx'
type Mode = 'production' | 'development'
type Placement = 'push' | 'unshift' | 'replace'

const RUN = 'globalThis.ran = (globalThis.ran || 0) + 1'

// The doubled spaces are the tell: the transpiler prints its own spacing.
const AUTHORED: Record<Language, string> = {
  js: `const  spaced = 'as written'\nexport default function main() { ${RUN}; return spaced }\n`,
  ts: `const  spaced: string = 'as written'\nexport default function main(): string { ${RUN}; return spaced }\n`,
  jsx: `const  spaced = 'as written'\nexport default function main() { ${RUN}; return <p title={spaced} /> }\n`,
  tsx: `const  spaced: string = 'as written'\nexport default function main(): unknown { ${RUN}; return <p title={spaced} /> }\n`
}

// Records what it was handed and its turn, then signs the text it returns.
const RECORDING_LOADER = [
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
].join('\n')

const RULES = [
  "rule('first')",
  "rule('second')",
  "rule('pre', 'pre')",
  "rule('post', 'post')"
].join(', ')

const PLACEMENTS: Record<Placement, string> = {
  push: `config.module.rules.push(${RULES})`,
  unshift: `config.module.rules.unshift(${RULES})`,
  replace: `config = {...config, module: {...config.module, rules: [${RULES}]}}`
}

function configFile(placement: Placement) {
  return [
    "const path = require('node:path')",
    'const rule = (label, enforce) => ({',
    '  test: /content[\\\\/]main\\.[a-z]+$/,',
    '  ...(enforce ? {enforce} : {}),',
    '  use: [{',
    "    loader: path.join(__dirname, 'record-loader.cjs'),",
    "    options: {label, dir: path.join(__dirname, 'seen')}",
    '  }]',
    '})',
    'module.exports = {',
    '  config: (config) => {',
    `    ${PLACEMENTS[placement]}`,
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

function project(language: Language, placement: Placement) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-user-loader-order-'))
  )
  roots.push(root)

  const usesJsx = language.endsWith('x')
  const usesTypes = language.startsWith('t')

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
      content_scripts: [
        {matches: ['<all_urls>'], js: [`content/main.${language}`]}
      ]
    })
  )

  write(root, `content/main.${language}`, AUTHORED[language])
  write(root, 'record-loader.cjs', RECORDING_LOADER)
  write(root, 'extension.config.js', configFile(placement))

  return root
}

async function build(root: string, mode: Mode) {
  const {extensionBuild} = await import('../../../command-build')
  const previous = process.env.VITEST
  process.env.VITEST = 'true'

  try {
    return await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false,
      mode,
      exitOnError: false
    } as any)
  } finally {
    if (previous === undefined) delete process.env.VITEST
    else process.env.VITEST = previous
  }
}

const SIGNATURE = /\n\/\* seen by [a-z]+ \*\/\n/g

// Names the text a loader was handed by what has already happened to it.
function reading(root: string, label: string, language: Language) {
  const text = fs.readFileSync(path.join(root, 'seen', `${label}.txt`), 'utf8')
  const unsigned = text.replace(SIGNATURE, '')
  const wrapped = text.includes('__EXTENSIONJS_mount(')
  const compiled = !text.includes('const  spaced')
  // The transpiler reprints the wrapper too, when the wrapper ran ahead of it.
  const wrapperReprinted = !text.includes(
    'var __EXTJS_WRAPPER_KIND="FS3_INLINE"'
  )
  let received = 'something else'

  if (unsigned === AUTHORED[language]) received = 'authored'
  else if (wrapped && !compiled) received = 'wrapped'
  else if (wrapped && wrapperReprinted) received = 'wrapped, then compiled'
  else if (wrapped) received = 'compiled, then wrapped'
  else if (compiled) received = 'compiled'

  return received
}

const turns = (root: string) =>
  fs.readFileSync(path.join(root, 'seen', 'order.txt'), 'utf8').trim()

// Runs the emitted content script on a page stub and counts the mounts.
function mounts(root: string) {
  const page: Record<string, unknown> = {
    document: {
      readyState: 'complete',
      addEventListener() {},
      removeEventListener() {}
    },
    console: {log() {}, warn() {}, error() {}},
    setTimeout,
    clearTimeout,
    queueMicrotask
  }
  page.globalThis = page
  page.window = page
  page.self = page

  const dist = path.join(root, 'dist', 'chrome')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')
  )

  vm.runInNewContext(
    fs.readFileSync(path.join(dist, manifest.content_scripts[0].js[0]), 'utf8'),
    page
  )

  return Number(page.ran || 0)
}

async function built(language: Language, mode: Mode, placement: Placement) {
  const root = project(language, placement)
  const summary = await build(root, mode)

  expect(summary.errors_count).toBe(0)

  return {
    order: turns(root),
    first: reading(root, 'first', language),
    second: reading(root, 'second', language),
    pre: reading(root, 'pre', language),
    post: reading(root, 'post', language),
    mounts: mounts(root)
  }
}

const LANGUAGES: Language[] = ['js', 'ts', 'jsx', 'tsx']
const MODES: Mode[] = ['production', 'development']

describe('what a user loader is handed for a content script', () => {
  for (const mode of MODES) {
    for (const language of LANGUAGES) {
      it(`${language} in ${mode}: by enforce class`, async () => {
        expect(await built(language, mode, 'push')).toEqual({
          order: 'pre second first post',
          first: 'wrapped',
          second: 'wrapped',
          pre: 'authored',
          post: 'wrapped, then compiled',
          mounts: 1
        })
      }, 120000)
    }
  }

  for (const placement of ['unshift', 'replace'] as const) {
    it(`reads the same for rules added by ${placement}`, async () => {
      expect(await built('ts', 'production', placement)).toEqual({
        order: 'pre second first post',
        first: 'wrapped',
        second: 'wrapped',
        pre: 'authored',
        post: 'wrapped, then compiled',
        mounts: 1
      })
    }, 120000)
  }
})

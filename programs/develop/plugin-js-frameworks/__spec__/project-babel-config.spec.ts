import {describe, expect, it} from 'vitest'
import {
  compileProject,
  configure,
  fakePackage,
  loaderOf,
  MANIFEST,
  makeProject,
  rulesOf
} from './project-fixture'

// A project plugin that rewrites one string, so the output shows Babel ran
// with the project's own config and nothing else.
const MARKER_PLUGIN =
  'module.exports = () => ({\n' +
  '  visitor: {\n' +
  '    StringLiteral(p) {\n' +
  "      if (p.node.value === 'MARK') p.node.value = 'BABEL_RAN'\n" +
  '    }\n' +
  '  }\n' +
  '})\n'

const TS_SOURCE = [
  'enum Kind { A, B }',
  'type Shape = {kind: Kind}',
  'const value = <string>(<unknown>"MARK")',
  'const shape: Shape = {kind: Kind.B}',
  'export const out = [value, shape.kind satisfies Kind]',
  'console.log(out)',
  ''
].join('\n')

const JS_SOURCE = "const label = 'MARK'\nconsole.log(label)\n"

const CONFIGS: Array<[string, Record<string, string | object>]> = [
  [
    'babel.config.json',
    {'babel.config.json': {plugins: ['./marker-plugin.cjs']}}
  ],
  [
    'babel.config.js',
    {
      'babel.config.js': "module.exports = {plugins: ['./marker-plugin.cjs']}\n"
    }
  ],
  ['.babelrc', {'.babelrc': {plugins: ['./marker-plugin.cjs']}}],
  [
    '.babelrc.cjs',
    {'.babelrc.cjs': "module.exports = {plugins: ['./marker-plugin.cjs']}\n"}
  ],
  [
    'a babel key in package.json',
    {
      'package.json': {
        name: 'fixture',
        babel: {plugins: ['./marker-plugin.cjs']}
      }
    }
  ]
]

function babelProject(config: Record<string, string | object>) {
  return makeProject({
    'package.json': {name: 'fixture'},
    'manifest.json': MANIFEST,
    'marker-plugin.cjs': MARKER_PLUGIN,
    'main.ts': TS_SOURCE,
    'page.js': JS_SOURCE,
    ...config
  })
}

const hasBabelLoader = (rules: ReturnType<typeof rulesOf>): boolean =>
  rules.some(
    (rule) =>
      loaderOf(rule).includes('babel-loader') ||
      hasBabelLoader(rule.oneOf || [])
  )

describe('a project with its own Babel config', () => {
  it.each(CONFIGS)(
    'runs %s on TypeScript and plain scripts, with SWC still stripping types',
    async (_name, config) => {
      const root = babelProject(config)
      const {errors, read} = await compileProject(root, {
        main: './main.ts',
        page: './page.js'
      })

      expect(errors).toEqual([])
      expect(read('main')).toContain('BABEL_RAN')
      expect(read('main')).not.toContain('MARK')
      expect(read('main')).not.toMatch(/type Shape|<string>/)
      expect(read('page')).toContain('BABEL_RAN')
    },
    60_000
  )

  it('parses JSX and decorators for Babel the way SWC compiles them', async () => {
    const root = makeProject({
      'package.json': {name: 'fixture', dependencies: {react: '19.0.0'}},
      'manifest.json': MANIFEST,
      'marker-plugin.cjs': MARKER_PLUGIN,
      'babel.config.json': {plugins: ['./marker-plugin.cjs']},
      'tsconfig.json': {compilerOptions: {experimentalDecorators: true}},
      'view.tsx':
        'const log = (...args: unknown[]) => args[0] as any\n' +
        "@log class A { name = 'MARK' }\n" +
        'export const el = <div title={new A().name} />\n' +
        'console.log(el)\n'
    })
    fakePackage(
      root,
      'react',
      {main: 'index.js'},
      {
        'index.js': 'module.exports = {}\n',
        'jsx-runtime.js': 'exports.jsx = function () { return null }\n',
        'jsx-dev-runtime.js': 'exports.jsxDEV = function () { return null }\n'
      }
    )

    const {errors, read} = await compileProject(root, {view: './view.tsx'})

    expect(errors).toEqual([])
    expect(read('view')).toContain('BABEL_RAN')
    expect(read('view')).not.toContain('<div')
  }, 60_000)

  it('parses standard decorators for Babel when the tsconfig asks for none', async () => {
    const root = makeProject({
      'package.json': {name: 'fixture'},
      'manifest.json': MANIFEST,
      'marker-plugin.cjs': MARKER_PLUGIN,
      'babel.config.json': {plugins: ['./marker-plugin.cjs']},
      'main.ts':
        'const log = (value: unknown, _context: unknown) => value as any\n' +
        "@log class A { name = 'MARK' }\n" +
        'console.log(new A().name)\n'
    })

    const {errors, read} = await compileProject(root, {main: './main.ts'})

    expect(errors).toEqual([])
    expect(read('main')).toContain('BABEL_RAN')
  }, 60_000)

  it('adds no Babel step to a project without a Babel config', async () => {
    const root = makeProject({
      'package.json': {name: 'fixture'},
      'manifest.json': MANIFEST,
      'main.ts': TS_SOURCE
    })

    expect(hasBabelLoader(rulesOf(await configure(root)))).toBe(false)
  })
})

const SOLID_WEB =
  'export const template = (html) => () => html\n' +
  'export const insert = () => {}\n' +
  'export const createComponent = (C, p) => C(p)\n' +
  'export const delegateEvents = () => {}\n'

function solidProject(files: Record<string, string | object>) {
  const root = makeProject({
    'package.json': {name: 'fixture', dependencies: {'solid-js': '1.9.0'}},
    'manifest.json': MANIFEST,
    'marker-plugin.cjs': MARKER_PLUGIN,
    ...files
  })
  fakePackage(
    root,
    'solid-js',
    {
      version: '1.9.0',
      type: 'module',
      exports: {
        '.': './dist/solid.js',
        './web': './web/dist/web.js',
        './h': './h/dist/h.js'
      }
    },
    {
      'dist/solid.js':
        'export const createSignal = (v) => [() => v, () => {}]\n',
      'web/dist/web.js': SOLID_WEB,
      'h/dist/h.js': 'export default () => null\n'
    }
  )

  return root
}

describe('a Solid project with its own Babel config', () => {
  it('runs the project config with Solid on .tsx, and on .ts and plain .js', async () => {
    const root = solidProject({
      'babel.config.json': {plugins: ['./marker-plugin.cjs']},
      'view.tsx':
        "type P = {label: string}\nconst label: string = 'MARK'\n" +
        'export const View = (p: P) => <button>{p.label}</button>\n' +
        'console.log(View({label}))\n',
      'main.ts': TS_SOURCE,
      'page.js': JS_SOURCE
    })

    const {errors, read} = await compileProject(root, {
      view: './view.tsx',
      main: './main.ts',
      page: './page.js'
    })

    expect(errors).toEqual([])
    expect(read('view')).toContain('BABEL_RAN')
    expect(read('view')).toContain('<button>')
    expect(read('view')).not.toMatch(/<button>\{/)
    expect(read('main')).toContain('BABEL_RAN')
    expect(read('page')).toContain('BABEL_RAN')
  }, 60_000)

  it('keeps Solid on its own Babel options without a project config', async () => {
    const root = solidProject({
      // A config Babel would find from the project if it looked: it must not.
      'nested/.babelrc': {plugins: ['./missing-plugin.cjs']},
      'nested/view.jsx':
        "export const View = () => <i>{'MARK'}</i>\nconsole.log(View())\n"
    })

    const {errors, read} = await compileProject(root, {
      view: './nested/view.jsx'
    })

    expect(errors).toEqual([])
    expect(read('view')).toContain('MARK')
  }, 60_000)
})

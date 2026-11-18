import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import postcss from 'postcss'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  isUsingPostCss,
  loadUserPostCssConfigObject,
  maybeUsePostCss
} from '../../css-tools/postcss'
import {cssProjects} from '../helpers/css-project'
import {canImportTypeScript} from '../helpers/typescript-import'

const makeProject = cssProjects()
const POSTCSS_LOADER = createRequire(import.meta.url).resolve('postcss-loader')
const SHIMS = [{'@tailwindcss/postcss': false}, {tailwindcss: false}]

afterEach(() => {
  vi.restoreAllMocks()
})

interface FakeOptions {
  // Thrown when the package is required, or when its factory is called.
  throwsOnRequire?: string
  throwsOnCall?: string
  // A rule the plugin appends, so a real PostCSS run shows it ran.
  appends?: string
}

// A package on disk in the project's node_modules. Each factory call is one
// JSON line in calls.log, so a test reads what the build passed it.
function fakePackage(root: string, name: string, fake: FakeOptions = {}) {
  const dir = path.join(root, 'node_modules', name)
  const log = path.join(root, 'calls.log')

  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({name, version: '1.0.0', main: 'index.js'})
  )

  fs.writeFileSync(
    path.join(dir, 'index.js'),
    [
      "const fs = require('fs')",
      fake.throwsOnRequire
        ? `throw new Error(${JSON.stringify(fake.throwsOnRequire)})`
        : '',
      'module.exports = function (opts) {',
      `  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({id: ${JSON.stringify(name)}, opts: opts === undefined ? null : opts}) + '\\n')`,
      fake.throwsOnCall
        ? `  throw new Error(${JSON.stringify(fake.throwsOnCall)})`
        : '',
      fake.appends
        ? `  return {postcssPlugin: ${JSON.stringify(name)}, Once(root) { root.append(${JSON.stringify(fake.appends)}) }}`
        : `  return {postcssPlugin: ${JSON.stringify(name)}}`,
      '}',
      ''
    ].join('\n')
  )
}

function calls(root: string): Array<{id: string; opts: unknown}> {
  const log = path.join(root, 'calls.log')

  if (!fs.existsSync(log)) return []

  return fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function packageJson(extra: Record<string, unknown> = {}) {
  return JSON.stringify({name: 'css-fixture', version: '0.0.0', ...extra})
}

function captureConsole() {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})

  return {
    warned: () => warn.mock.calls.map((args) => args.join(' ')),
    errored: () => error.mock.calls.map((args) => args.join(' '))
  }
}

function pluginNames(rule: Record<string, any>) {
  return (rule.options.postcssOptions.plugins as Array<any>).map((plugin) =>
    plugin && typeof plugin === 'object' && 'postcssPlugin' in plugin
      ? plugin.postcssPlugin
      : plugin
  )
}

describe('isUsingPostCss', () => {
  it.each([
    ['a postcss dependency', {devDependencies: {postcss: '^8.0.0'}}, {}, true],
    ['a config file', {}, {'postcss.config.js': 'module.exports = {}'}, true],
    [
      'a Tailwind dependency',
      {devDependencies: {tailwindcss: '^4.0.0'}},
      {},
      true
    ],
    [
      'the Tailwind PostCSS plugin',
      {devDependencies: {'@tailwindcss/postcss': '^4.0.0'}},
      {},
      true
    ],
    ['nothing', {}, {}, false]
  ])('answers for %s', (_label, pkg, files, expected) => {
    const root = makeProject({'package.json': packageJson(pkg), ...files})

    expect(isUsingPostCss(root)).toBe(expected)
  })
})

// Every shape a user writes a config in, with no Tailwind in the project.
describe('maybeUsePostCss reads each config shape', () => {
  const plugin = {'fake-plugin': {marker: 1}}

  it.each([
    [
      'postcss.config.js',
      `module.exports = {plugins: ${JSON.stringify(plugin)}}`
    ],
    [
      'postcss.config.cjs',
      `module.exports = {plugins: ${JSON.stringify(plugin)}}`
    ],
    [
      'postcss.config.mjs',
      `export default {plugins: [['fake-plugin', {marker: 1}]]}`
    ],
    ['.postcssrc', JSON.stringify({plugins: plugin})],
    ['.postcssrc.json', JSON.stringify({plugins: plugin})]
  ])('%s resolves its plugins from the project', async (file, text) => {
    const root = makeProject({[file]: text})
    fakePackage(root, 'fake-plugin')

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule).toEqual({
      loader: POSTCSS_LOADER,
      options: {
        postcssOptions: {
          cwd: root,
          config: false,
          plugins: [{postcssPlugin: 'fake-plugin'}]
        },
        sourceMap: true
      }
    })

    expect(calls(root)).toEqual([{id: 'fake-plugin', opts: {marker: 1}}])
  })

  it('reads the postcss key of package.json ahead of a config file', async () => {
    const root = makeProject({
      'package.json': packageJson({postcss: {plugins: plugin}}),
      'postcss.config.js': "module.exports = {plugins: {'other-plugin': {}}}"
    })
    fakePackage(root, 'fake-plugin')
    fakePackage(root, 'other-plugin')

    const rule = await maybeUsePostCss(root, {mode: 'production'})

    expect(rule.options).toEqual({
      postcssOptions: {
        cwd: root,
        config: false,
        plugins: [{postcssPlugin: 'fake-plugin'}]
      },
      sourceMap: false
    })

    expect(calls(root).map((call) => call.id)).toEqual(['fake-plugin'])
  })

  it('calls a function export with the mode and the project folder', async () => {
    const root = makeProject({
      'postcss.config.js': [
        'module.exports = (ctx) => ({',
        "  plugins: [require('fake-plugin')(ctx)]",
        '})'
      ].join('\n')
    })
    fakePackage(root, 'fake-plugin')

    const rule = await maybeUsePostCss(root, {mode: 'production'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: false,
      plugins: [{postcssPlugin: 'fake-plugin'}]
    })

    expect(calls(root)).toEqual([
      {
        id: 'fake-plugin',
        opts: {env: 'production', mode: 'production', cwd: root}
      }
    ])
  })

  it('hands a config with no plugins to postcss-loader by its path', async () => {
    const root = makeProject({'postcss.config.js': 'module.exports = {}'})

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule).toEqual({
      loader: POSTCSS_LOADER,
      options: {
        postcssOptions: {
          cwd: root,
          config: path.join(root, 'postcss.config.js')
        },
        sourceMap: true
      }
    })
  })

  it('hands a YAML config to postcss-loader, which has the parser', async () => {
    const root = makeProject({
      '.postcssrc.yml': 'plugins:\n  fake-plugin: {}\n'
    })

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: path.join(root, '.postcssrc.yml')
    })

    expect(calls(root)).toEqual([])
  })

  it('points postcss-loader at the project for an empty postcss key', async () => {
    const root = makeProject({'package.json': packageJson({postcss: {}})})

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({cwd: root, config: root})
  })

  it.each([
    ['nothing', {}],
    // Neither the build nor postcss-loader searches this name.
    [
      'a postcss.config.json',
      {'postcss.config.json': JSON.stringify({plugins: plugin})}
    ]
  ])('adds no loader to a project with %s', async (_label, files) => {
    const root = makeProject(files)

    expect(await maybeUsePostCss(root, {mode: 'development'})).toEqual({})
  })
})

describe('maybeUsePostCss reports a config it cannot use', () => {
  it('sets aside a config that throws, saying so once, and adds no loader', async () => {
    const root = makeProject({
      'postcss.config.cjs': 'throw new Error("boom in config")\n'
    })
    const output = captureConsole()

    expect(await maybeUsePostCss(root, {mode: 'development'})).toEqual({})
    expect(output.warned()).toEqual([
      `⏵⏵⏵ Could not load the PostCSS config at ${path.join(root, 'postcss.config.cjs')}.\n` +
        'boom in config\n' +
        'The build continues without it, so none of its plugins run. Fix the file or remove it.'
    ])
  })

  it('sets aside plugins of a shape PostCSS cannot take', async () => {
    const root = makeProject({
      '.postcssrc.json': JSON.stringify({plugins: 'tailwindcss'})
    })
    const output = captureConsole()

    expect(await maybeUsePostCss(root, {mode: 'development'})).toEqual({})
    expect(output.warned()).toEqual([
      `⏵⏵⏵ The PostCSS config at ${path.join(root, '.postcssrc.json')} lists plugins as string.\n` +
        'PostCSS expects an array or an object keyed by plugin name.\n' +
        'The build continues without this config, so none of its plugins run.'
    ])
  })

  it('skips a plugin it cannot resolve and keeps the others', async () => {
    const root = makeProject({
      '.postcssrc.json': JSON.stringify({
        plugins: {'fake-plugin': {}, 'postcss-plugin-nowhere-installed': {}}
      })
    })
    fakePackage(root, 'fake-plugin')
    const output = captureConsole()

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(pluginNames(rule)).toEqual(['fake-plugin'])
    expect(output.errored()).toEqual([
      "⏵⏵⏵ Couldn't resolve the PostCSS plugin postcss-plugin-nowhere-installed.\n" +
        'The plugin was skipped so the build can continue.\n' +
        'Styles it would generate are missing from the output.\n' +
        `PATH ${root}\n` +
        'Install it in your project to re-enable it: npm install --save-dev postcss-plugin-nowhere-installed'
    ])
  })

  it('reads a TypeScript config itself where it can import one, else leaves it to postcss-loader', async () => {
    const root = makeProject({
      'postcss.config.ts': "export default {plugins: {'fake-plugin': {}}}\n"
    })
    fakePackage(root, 'fake-plugin')
    const output = captureConsole()

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual(
      (await canImportTypeScript())
        ? {cwd: root, config: false, plugins: [{postcssPlugin: 'fake-plugin'}]}
        : {cwd: root, config: path.join(root, 'postcss.config.ts')}
    )

    expect(output.warned()).toEqual([])
  })
})

describe('loadUserPostCssConfigObject', () => {
  it('returns a readable config as written', async () => {
    const root = makeProject({
      'postcss.fine.json': JSON.stringify({plugins: {autoprefixer: {}}})
    })
    const output = captureConsole()

    expect(
      await loadUserPostCssConfigObject(
        path.join(root, 'postcss.fine.json'),
        root,
        'development'
      )
    ).toEqual({plugins: {autoprefixer: {}}})

    expect(output.warned()).toEqual([])
  })
})

// Fake Tailwind packages live in the project. A bare require from it also
// reaches NODE_PATH and folders above, so a test with only tailwindcss declares v3.
describe('maybeUsePostCss with Tailwind', () => {
  it('injects the v4 plugin anchored at the project when there is no config', async () => {
    const root = makeProject({
      'package.json': packageJson({
        devDependencies: {
          tailwindcss: '^4.0.0',
          '@tailwindcss/postcss': '^4.0.0'
        }
      })
    })
    fakePackage(root, '@tailwindcss/postcss')

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: root,
      plugins: [...SHIMS, {postcssPlugin: '@tailwindcss/postcss'}]
    })

    expect(calls(root)).toEqual([
      {id: '@tailwindcss/postcss', opts: {base: root}}
    ])
  })

  it('leaves the plugins of a config that does not name Tailwind alone', async () => {
    const root = makeProject({
      'package.json': packageJson({devDependencies: {tailwindcss: '^4.0.0'}}),
      'postcss.config.js': 'module.exports = {}'
    })
    fakePackage(root, '@tailwindcss/postcss')

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: path.join(root, 'postcss.config.js')
    })

    expect(calls(root)).toEqual([])
  })

  // The search also tries the folder the CLI runs from, so a project that
  // declares Tailwind and holds none of it gets the plugin installed there.
  it('still returns the PostCSS rule when the project holds no Tailwind package', async () => {
    const root = makeProject({
      'package.json': packageJson({
        devDependencies: {
          tailwindcss: '^4.0.0',
          '@tailwindcss/postcss': '^4.0.0'
        }
      })
    })

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.loader).toBe(POSTCSS_LOADER)
    expect(rule.options.postcssOptions.config).toBe(root)
    // Pins today's behavior: the plugin is the one beside the CLI.
    expect(pluginNames(rule)).toEqual([...SHIMS, '@tailwindcss/postcss'])
  })

  it('injects Tailwind for a TypeScript config, read here where it can import one', async () => {
    const root = makeProject({
      'package.json': packageJson({
        devDependencies: {'@tailwindcss/postcss': '^4.0.0'}
      }),
      'postcss.config.ts':
        "export default {plugins: {'@tailwindcss/postcss': {}}}\n"
    })
    fakePackage(root, '@tailwindcss/postcss')

    const rule = await maybeUsePostCss(root, {mode: 'development'})
    const instance = {postcssPlugin: '@tailwindcss/postcss'}

    expect(rule.options.postcssOptions).toEqual(
      (await canImportTypeScript())
        ? {cwd: root, config: false, plugins: [instance]}
        : {
            cwd: root,
            config: path.join(root, 'postcss.config.ts'),
            plugins: [...SHIMS, instance]
          }
    )
  })

  it('runs the injected plugin in a real PostCSS pass', async () => {
    const root = makeProject({
      'package.json': packageJson({
        devDependencies: {'@tailwindcss/postcss': '^4.0.0'}
      })
    })
    fakePackage(root, '@tailwindcss/postcss', {
      appends: '.from-\\[\\#1a1333\\]{--tw-gradient-from:#1a1333}'
    })

    const rule = await maybeUsePostCss(root, {mode: 'development'})
    const plugins = rule.options.postcssOptions.plugins
    const out = await postcss([plugins[2]]).process('@import "tailwindcss";', {
      from: undefined
    })

    expect(out.css).toBe(
      '@import "tailwindcss";.from-\\[\\#1a1333\\]{--tw-gradient-from:#1a1333}'
    )
  })

  it('prefers @tailwindcss/postcss over tailwindcss when no v3 is declared', async () => {
    const root = makeProject({
      'package.json': packageJson({devDependencies: {tailwindcss: 'latest'}}),
      'postcss.config.js': "module.exports = {plugins: ['tailwindcss']}"
    })
    fakePackage(root, '@tailwindcss/postcss')
    fakePackage(root, 'tailwindcss')

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: false,
      plugins: [{postcssPlugin: '@tailwindcss/postcss'}]
    })

    expect(calls(root)).toEqual([
      {id: '@tailwindcss/postcss', opts: {base: root}}
    ])
  })

  it('injects Tailwind for a config that names it in a project that does not declare it', async () => {
    const root = makeProject({
      'postcss.config.js': "module.exports = {plugins: ['tailwindcss']}"
    })
    fakePackage(root, '@tailwindcss/postcss')

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(pluginNames(rule)).toEqual(['@tailwindcss/postcss'])
    expect(calls(root)).toEqual([
      {id: '@tailwindcss/postcss', opts: {base: root}}
    ])
  })

  it('swaps a string tailwindcss entry of a .cjs config for the instance it made', async () => {
    const root = makeProject({
      'package.json': packageJson({devDependencies: {tailwindcss: '^3.4.13'}}),
      'postcss.config.cjs': "module.exports = {plugins: ['tailwindcss']}"
    })
    fakePackage(root, 'tailwindcss')

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: false,
      plugins: [{postcssPlugin: 'tailwindcss'}]
    })

    // The v3 plugin takes the project's tailwind.config, here none.
    expect(calls(root)).toEqual([{id: 'tailwindcss', opts: null}])
  })

  // A monorepo root can hold the v4 plugin, a v3 project's own package must win.
  it('keeps the project tailwindcss of a v3 project over a v4 plugin found above it', async () => {
    const root = makeProject({
      'app/package.json': packageJson({
        devDependencies: {tailwindcss: '^3.4.13'}
      }),
      'app/postcss.config.cjs': "module.exports = {plugins: ['tailwindcss']}"
    })
    const app = path.join(root, 'app')
    fakePackage(root, '@tailwindcss/postcss')
    fakePackage(app, 'tailwindcss')

    const rule = await maybeUsePostCss(app, {mode: 'development'})

    expect(rule.options.postcssOptions.plugins).toEqual([
      {postcssPlugin: 'tailwindcss'}
    ])

    expect(calls(app)).toEqual([{id: 'tailwindcss', opts: null}])
    expect(calls(root)).toEqual([])
  })

  it('injects Tailwind next to a YAML config postcss-loader reads', async () => {
    const root = makeProject({
      'package.json': packageJson({
        devDependencies: {'@tailwindcss/postcss': '^4.0.0'}
      }),
      '.postcssrc.yml': "plugins:\n  '@tailwindcss/postcss': {}\n"
    })
    fakePackage(root, '@tailwindcss/postcss')

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: path.join(root, '.postcssrc.yml'),
      plugins: [...SHIMS, {postcssPlugin: '@tailwindcss/postcss'}]
    })
  })

  it('bypasses a CommonJS postcss.config.js in a type module project', async () => {
    const root = makeProject({
      'package.json': packageJson({
        type: 'module',
        devDependencies: {tailwindcss: '^3.4.13', autoprefixer: '^10.0.0'}
      }),
      'postcss.config.js':
        "const tailwindcss = require('tailwindcss'); module.exports = {plugins: [tailwindcss]}"
    })
    fakePackage(root, 'tailwindcss')
    fakePackage(root, 'autoprefixer')
    const output = captureConsole()

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: false,
      plugins: [{postcssPlugin: 'tailwindcss'}, {postcssPlugin: 'autoprefixer'}]
    })

    expect(output.warned()).toEqual([])
  })

  it('bypasses a v3 config that requires tailwindcss as a function', async () => {
    const root = makeProject({
      'package.json': packageJson({devDependencies: {tailwindcss: '^3.4.13'}}),
      'postcss.config.js': [
        "const tailwindcss = require('tailwindcss')",
        'module.exports = {plugins: [tailwindcss]}'
      ].join('\n')
    })
    fakePackage(root, 'tailwindcss')

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: false,
      plugins: [...SHIMS, {postcssPlugin: 'tailwindcss'}]
    })
  })

  it('falls back to @tailwindcss/postcss when the tailwindcss plugin refuses to start', async () => {
    const refusal =
      "It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin."
    const root = makeProject({
      'package.json': packageJson({
        devDependencies: {tailwindcss: '^3.4.13', autoprefixer: '^10.0.0'}
      }),
      'postcss.config.js': [
        "const tailwindcss = require('tailwindcss')",
        "const autoprefixer = require('autoprefixer')",
        'module.exports = {plugins: [tailwindcss, autoprefixer]}'
      ].join('\n')
    })
    fakePackage(root, 'tailwindcss', {throwsOnCall: refusal})
    fakePackage(root, '@tailwindcss/postcss')
    fakePackage(root, 'autoprefixer')

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: false,
      plugins: [
        ...SHIMS,
        {postcssPlugin: '@tailwindcss/postcss'},
        {postcssPlugin: 'autoprefixer'}
      ]
    })

    expect(calls(root)).toEqual([
      {id: 'tailwindcss', opts: null},
      {id: 'tailwindcss', opts: null},
      {id: '@tailwindcss/postcss', opts: {base: root}},
      {id: 'autoprefixer', opts: null}
    ])
  })

  it('reports a config whose tailwindcss require throws, then injects v4 and autoprefixer', async () => {
    const refusal =
      "It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin."
    const root = makeProject({
      'package.json': packageJson({
        devDependencies: {tailwindcss: 'latest', autoprefixer: '^10.0.0'}
      }),
      'postcss.config.js': [
        "const tailwindcss = require('tailwindcss')",
        "const autoprefixer = require('autoprefixer')",
        'module.exports = {plugins: [tailwindcss, autoprefixer]}'
      ].join('\n')
    })
    fakePackage(root, 'tailwindcss', {throwsOnRequire: refusal})
    fakePackage(root, '@tailwindcss/postcss')
    fakePackage(root, 'autoprefixer')
    const output = captureConsole()

    const rule = await maybeUsePostCss(root, {mode: 'development'})

    expect(rule.options.postcssOptions).toEqual({
      cwd: root,
      config: false,
      plugins: [
        ...SHIMS,
        {postcssPlugin: '@tailwindcss/postcss'},
        {postcssPlugin: 'autoprefixer'}
      ]
    })

    expect(output.warned()).toHaveLength(1)
    expect(output.warned()[0]).toContain(
      `Could not load the PostCSS config at ${path.join(root, 'postcss.config.js')}.\n${refusal}`
    )
  })
})

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {type RspackPluginInstance, rspack, type Stats} from '@rspack/core'
import {describe, expect, it, vi} from 'vitest'
import type {JsFrameworkLoader, JsFrameworkRule} from '../../../types'
import {maybeUseSvelte} from '../../js-tools/svelte'
import {fakePackage, makeProject} from '../project-fixture'

// svelte-loader is not in the fixture, so it resolves from Extension.js.
const fromDevelop = createRequire(
  path.join(__dirname, '..', '..', '..', 'x.js')
)
const svelteLoader = fromDevelop.resolve('svelte-loader')

const CLIENT_FILES = {
  'src/index-client.js': '',
  'src/store/index-client.js': '',
  'src/reactivity/index-client.js': '',
  'src/legacy/legacy-client.js': '',
  'src/internal/client/index.js': ''
}

// The project holds the release the compiler has, so its own copy links.
const compilerVersion = createRequire(svelteLoader)('svelte/package.json')
  .version as string

function svelteProject(files: Record<string, string> = {}) {
  const root = makeProject({
    'package.json': {dependencies: {svelte: compilerVersion}},
    ...files
  })
  const dir = fakePackage(
    root,
    'svelte',
    {version: compilerVersion},
    CLIENT_FILES
  )

  return {root, dir}
}

function svelteLoaderOptionsFor(rules: JsFrameworkRule[], file: string) {
  const matching = rules.filter((rule) => rule.test.test(file))
  expect(matching).toHaveLength(1)

  const entries = [matching[0].use].flat() as JsFrameworkLoader[]

  return entries.filter((entry) => entry.loader === svelteLoader)[0]?.options
}

describe('maybeUseSvelte', () => {
  it('aliases the client entries of the project svelte', async () => {
    const {root, dir} = svelteProject()
    const result = await maybeUseSvelte(root, 'development')

    expect(result?.alias).toEqual({
      svelte: path.join(dir, 'src', 'index-client.js'),
      'svelte/store': path.join(dir, 'src', 'store', 'index-client.js'),
      'svelte/reactivity': path.join(
        dir,
        'src',
        'reactivity',
        'index-client.js'
      ),
      'svelte/legacy': path.join(dir, 'src', 'legacy', 'legacy-client.js'),
      'svelte/internal': path.join(dir, 'src', 'internal')
    })
  })

  it('gives .svelte, .svelte.js and .svelte.ts the same loader options, merged with svelte.loader.mjs', async () => {
    const {root} = svelteProject({
      'svelte.loader.mjs': 'export default {bar: 2}\n'
    })
    const rules = (await maybeUseSvelte(root, 'development'))
      ?.loaders as JsFrameworkRule[]
    const component = svelteLoaderOptionsFor(rules, '/p/Counter.svelte')

    expect(component).toEqual({
      emitCss: true,
      compilerOptions: {dev: true},
      hotReload: true,
      bar: 2
    })

    expect(svelteLoaderOptionsFor(rules, '/p/state.svelte.js')).toEqual(
      component
    )

    expect(svelteLoaderOptionsFor(rules, '/p/state.svelte.ts')).toEqual(
      component
    )

    const tsRule = rules.find((rule) => rule.test.test('/p/state.svelte.ts'))
    const [, typeStrip] = tsRule?.use as JsFrameworkLoader[]
    expect(typeStrip).toEqual({
      loader: 'builtin:swc-loader',
      options: {jsc: {parser: {syntax: 'typescript'}, target: 'esnext'}}
    })
  })

  it('keeps dev on and hot reload off for a build no session reloads', async () => {
    const {root} = svelteProject()
    const rules = (
      await maybeUseSvelte(root, 'development', {hotReload: false})
    )?.loaders as JsFrameworkRule[]

    expect(svelteLoaderOptionsFor(rules, '/p/Counter.svelte')).toEqual({
      emitCss: true,
      compilerOptions: {dev: true},
      hotReload: false
    })
  })

  it('turns dev and hot reload off in production', async () => {
    const {root} = svelteProject()
    const rules = (await maybeUseSvelte(root, 'production'))
      ?.loaders as JsFrameworkRule[]

    expect(svelteLoaderOptionsFor(rules, '/p/Counter.svelte')).toEqual({
      emitCss: true,
      compilerOptions: {dev: false},
      hotReload: false
    })
  })

  it('compiles a component that ships inside node_modules', async () => {
    const {root} = svelteProject()
    const rules = (await maybeUseSvelte(root, 'development'))
      ?.loaders as JsFrameworkRule[]
    const rulesFor = (file: string) =>
      rules.filter((rule) => rule.test.test(file))

    for (const file of ['Button.svelte', 'state.svelte.ts']) {
      const matching = rulesFor(`/p/node_modules/fancy-svelte-lib/${file}`)
      expect(matching).toHaveLength(1)
      expect(matching[0].exclude).toBeUndefined()
    }
  })

  it('keeps dev compilation on when the project sets its own compilerOptions', async () => {
    const {root} = svelteProject({
      'svelte.loader.mjs': 'export default {compilerOptions: {runes: true}}\n'
    })
    const rules = (await maybeUseSvelte(root, 'development'))
      ?.loaders as JsFrameworkRule[]

    expect(svelteLoaderOptionsFor(rules, '/p/App.svelte')).toEqual({
      emitCss: true,
      compilerOptions: {dev: true, runes: true},
      hotReload: true
    })
  })

  it('adds .svelte, the project node_modules and the svelte condition to resolve', async () => {
    const {root} = svelteProject()
    const [resolverPlugin] = (await maybeUseSvelte(root, 'development'))
      ?.plugins as Array<{apply(compiler: unknown): void}>
    const importResolve = {conditionNames: ['browser', 'import', 'default']}
    const compiler = {
      options: {
        resolve: {
          conditionNames: ['browser', 'import'],
          byDependency: {
            esm: importResolve,
            worker: importResolve,
            commonjs: {conditionNames: ['browser', 'require', 'default']},
            'css-import': {conditionNames: ['development', 'style']},
            url: {preferRelative: true}
          },
          extensions: ['.js', '.svelte'],
          modules: ['node_modules']
        }
      }
    }

    resolverPlugin.apply(compiler)

    expect(compiler.options.resolve).toEqual({
      conditionNames: ['svelte', 'browser', 'import'],
      byDependency: {
        esm: {conditionNames: ['svelte', 'browser', 'import', 'default']},
        worker: {conditionNames: ['svelte', 'browser', 'import', 'default']},
        commonjs: {conditionNames: ['svelte', 'browser', 'require', 'default']},
        'css-import': {conditionNames: ['development', 'style']},
        url: {preferRelative: true}
      },
      extensions: ['.svelte', '.js'],
      modules: ['node_modules', path.join(root, 'node_modules')]
    })

    // The shared list the config hands several dependency types stays as is.
    expect(importResolve.conditionNames).toEqual([
      'browser',
      'import',
      'default'
    ])
  })

  it('adds the svelte condition once, and leaves an unset list to the bundler', async () => {
    const {root} = svelteProject()
    const [resolverPlugin] = (await maybeUseSvelte(root, 'development'))
      ?.plugins as Array<{apply(compiler: unknown): void}>
    const already = {
      options: {resolve: {conditionNames: ['browser', 'svelte', 'import']}}
    }
    const unset = {options: {resolve: {} as Record<string, unknown>}}

    resolverPlugin.apply(already)
    resolverPlugin.apply(unset)

    expect(already.options.resolve.conditionNames).toEqual([
      'browser',
      'svelte',
      'import'
    ])

    expect(unset.options.resolve.conditionNames).toBeUndefined()
    expect(unset.options.resolve.byDependency).toBeUndefined()
  })

  it('never reads svelte from the folder the command runs in', async () => {
    const bare = makeProject({'package.json': {dependencies: {svelte: '5'}}})
    const elsewhere = makeProject({'package.json': {}})
    fakePackage(elsewhere, 'svelte', {version: '99.0.0'}, CLIENT_FILES)
    const {root, dir} = svelteProject()
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(elsewhere)

    try {
      const withoutItsOwn = await maybeUseSvelte(bare, 'development')
      const withItsOwn = await maybeUseSvelte(root, 'development')
      // With none of its own the project runs on the compiler's svelte.
      const compilerRoot = path.dirname(
        createRequire(svelteLoader).resolve('svelte/package.json')
      )

      expect(withoutItsOwn?.alias?.svelte).toBe(
        path.join(compilerRoot, 'src', 'index-client.js')
      )

      expect(withItsOwn?.alias?.svelte).toBe(
        path.join(dir, 'src', 'index-client.js')
      )
    } finally {
      cwd.mockRestore()
    }
  })

  it('runs a project that holds a newer svelte on the compiler copy', async () => {
    const root = makeProject({
      'package.json': {dependencies: {svelte: '99.0.0'}}
    })
    fakePackage(root, 'svelte', {version: '99.0.0'}, CLIENT_FILES)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const result = await maybeUseSvelte(root, 'development')
      const compilerRoot = path.dirname(
        createRequire(svelteLoader).resolve('svelte/package.json')
      )

      expect(result?.alias).toMatchObject({
        svelte: path.join(compilerRoot, 'src', 'index-client.js'),
        'svelte/internal': path.join(compilerRoot, 'src', 'internal')
      })

      expect(String(warn.mock.calls[0]?.[0])).toContain('99.0.0')
    } finally {
      warn.mockRestore()
    }
  })

  it('returns undefined when svelte is not a dependency', async () => {
    expect(
      await maybeUseSvelte(makeProject({'package.json': {}}), 'development')
    ).toBeUndefined()
  })
})

// The project folder is a place to look after the walk up from the importer,
// so a package keeps the version installed inside it.
// A compiler with no extension list of its own still resolves by the
// bundler's defaults, with .svelte added after them.
describe('the Svelte resolver setup on a compiler with no extension list', () => {
  it('keeps resolving a script by the default extensions', async () => {
    const {root} = svelteProject({
      'index.js': 'import "./dep"\n',
      'dep.js': 'console.log("DEFAULT EXTENSION")\n'
    })
    const setup = await maybeUseSvelte(root, 'production')
    const compiler = rspack({
      context: root,
      mode: 'none',
      entry: './index.js',
      output: {path: path.join(root, 'out'), filename: 'bundle.js'},
      plugins: setup?.plugins as RspackPluginInstance[]
    })

    const stats = await new Promise<Stats>((resolve, reject) => {
      compiler.run((error, result) =>
        error || !result ? reject(error) : resolve(result)
      )
    })
    await new Promise((done) => compiler.close(done))

    expect(
      stats
        .toJson({all: false, errors: true})
        .errors?.map(({message}) => message.split('\n')[0].trim())
    ).toEqual([])

    expect(
      fs
        .readFileSync(path.join(root, 'out', 'bundle.js'), 'utf8')
        .includes('DEFAULT EXTENSION')
    ).toBe(true)
  })
})

describe('the Svelte resolver setup and a nested dependency', () => {
  it('lets a package resolve its own nested copy before the top-level one', async () => {
    const {root} = svelteProject({
      'index.js': 'import "a"\n',
      'node_modules/a/package.json': '{"name":"a","version":"1.0.0"}',
      'node_modules/a/index.js': 'import "b"\n',
      'node_modules/a/node_modules/b/package.json':
        '{"name":"b","version":"1.0.0"}',
      'node_modules/a/node_modules/b/index.js': 'console.log("NESTED B")\n',
      'node_modules/b/package.json': '{"name":"b","version":"2.0.0"}',
      'node_modules/b/index.js': 'console.log("TOP LEVEL B")\n'
    })
    const setup = await maybeUseSvelte(root, 'production')
    const compiler = rspack({
      context: root,
      mode: 'none',
      entry: './index.js',
      output: {path: path.join(root, 'out'), filename: 'bundle.js'},
      resolve: {
        extensions: ['.js'],
        modules: ['node_modules', path.join(root, 'node_modules')]
      },
      plugins: setup?.plugins as RspackPluginInstance[]
    })

    const stats = await new Promise<Stats>((resolve, reject) => {
      compiler.run((error, result) =>
        error || !result ? reject(error) : resolve(result)
      )
    })
    await new Promise((done) => compiler.close(done))

    const bundle = fs.readFileSync(path.join(root, 'out', 'bundle.js'), 'utf8')

    expect(stats.hasErrors()).toBe(false)
    expect({
      nested: bundle.includes('NESTED B'),
      topLevel: bundle.includes('TOP LEVEL B')
    }).toEqual({nested: true, topLevel: false})

    expect(compiler.options.resolve.modules).toEqual([
      'node_modules',
      path.join(root, 'node_modules')
    ])
  })
})

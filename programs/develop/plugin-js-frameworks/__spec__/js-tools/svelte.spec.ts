import {createRequire} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
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

// A project svelte newer than any compiler, so the project copy always links.
function svelteProject(files: Record<string, string> = {}) {
  const root = makeProject({
    'package.json': {dependencies: {svelte: '99.0.0'}},
    ...files
  })
  const dir = fakePackage(root, 'svelte', {version: '99.0.0'}, CLIENT_FILES)

  return {root, dir}
}

type Rule = {
  test: RegExp
  use?: unknown
  exclude?: unknown
  resolve?: unknown
}

function svelteLoaderOptionsFor(rules: Rule[], file: string) {
  const matching = rules.filter((rule) => rule.test.test(file))
  expect(matching).toHaveLength(1)

  const entries = [matching[0].use].flat() as Array<{
    loader: string
    options: unknown
  }>

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
    const rules = (await maybeUseSvelte(root, 'development'))?.loaders as Rule[]
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
    const [, typeStrip] = tsRule?.use as Array<{
      loader: string
      options: unknown
    }>
    expect(typeStrip).toEqual({
      loader: 'builtin:swc-loader',
      options: {jsc: {parser: {syntax: 'typescript'}, target: 'esnext'}}
    })
  })

  it('turns dev and hot reload off in production', async () => {
    const {root} = svelteProject()
    const rules = (await maybeUseSvelte(root, 'production'))?.loaders as Rule[]

    expect(svelteLoaderOptionsFor(rules, '/p/Counter.svelte')).toEqual({
      emitCss: true,
      compilerOptions: {dev: false},
      hotReload: false
    })
  })

  it('compiles a component that ships inside node_modules', async () => {
    const {root} = svelteProject()
    const rules = (await maybeUseSvelte(root, 'development'))?.loaders as Rule[]
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
    const rules = (await maybeUseSvelte(root, 'development'))?.loaders as Rule[]

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
      modules: [path.join(root, 'node_modules'), 'node_modules']
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

  it('reads svelte from the fallback folder only when the project has none', async () => {
    const bare = makeProject({'package.json': {dependencies: {svelte: '5'}}})
    const fallback = makeProject({'package.json': {}})
    const fallbackDir = fakePackage(
      fallback,
      'svelte',
      {version: '99.0.0'},
      CLIENT_FILES
    )
    const {root, dir} = svelteProject()

    const fromFallback = await maybeUseSvelte(bare, 'development', {
      cwd: fallback
    })
    const fromProject = await maybeUseSvelte(root, 'development', {
      cwd: fallback
    })

    expect(fromFallback?.alias?.svelte).toBe(
      path.join(fallbackDir, 'src', 'index-client.js')
    )

    expect(fromProject?.alias?.svelte).toBe(
      path.join(dir, 'src', 'index-client.js')
    )
  })

  it('returns undefined when svelte is not a dependency', async () => {
    expect(
      await maybeUseSvelte(makeProject({'package.json': {}}), 'development')
    ).toBeUndefined()
  })
})

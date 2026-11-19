import {createRequire} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  maybeUseVue,
  resolveVueBundlerEntry,
  VueFeatureFlagsPlugin
} from '../../js-tools/vue'
import {fakePackage, makeProject} from '../project-fixture'

// vue-loader is not in the fixture, so it resolves from Extension.js.
const fromDevelop = createRequire(
  path.join(__dirname, '..', '..', '..', 'x.js')
)

function vueThreeProject(files: Record<string, string> = {}) {
  const root = makeProject({
    'package.json': {dependencies: {vue: '^3.5.0'}},
    ...files
  })

  for (const name of [
    'vue',
    '@vue/runtime-dom',
    '@vue/runtime-core',
    '@vue/shared'
  ]) {
    fakePackage(
      root,
      name,
      {version: '3.5.0', main: 'index.js', module: 'dist/esm-bundler.js'},
      {'index.js': '', 'dist/esm-bundler.js': ''}
    )
  }

  return root
}

function vueTwoProject() {
  const root = makeProject({
    'package.json': {name: 'vue2-fixture', dependencies: {vue: '^2.7.16'}}
  })
  const vueDir = fakePackage(
    root,
    'vue',
    {version: '2.7.16', main: 'index.js', module: 'dist/vue.runtime.esm.js'},
    {'index.js': '', 'dist/vue.runtime.esm.js': ''}
  )

  return {root, vueDir}
}

// The two hooks the refusal taps, run by hand over a list of modules.
function finishModules(plugin: unknown, context: string, modules: unknown[]) {
  const errors: Array<Error & {file?: string}> = []
  const compilation = {
    errors,
    hooks: {
      finishModules: {
        tap: (_name: string, fn: (m: unknown[]) => void) => fn(modules)
      }
    }
  }

  ;(plugin as {apply(compiler: unknown): void}).apply({
    context,
    hooks: {
      thisCompilation: {
        tap: (_name: string, fn: (c: unknown) => void) => fn(compilation)
      }
    }
  })

  return errors
}

describe('maybeUseVue', () => {
  it('returns the vue-loader rule, VueLoaderPlugin, the feature flags and runtime-only aliases', async () => {
    const root = vueThreeProject({
      'vue.loader.mjs': 'export default {foo: 1}\n'
    })
    const result = await maybeUseVue(root, 'development')
    const [rule] = result?.loaders || []

    expect(rule).toMatchObject({
      test: /\.vue$/,
      loader: fromDevelop.resolve('vue-loader'),
      options: {experimentalInlineMatchResource: true, foo: 1}
    })

    // A .vue file in a dependency is source too, the way .svelte is.
    expect(rule.include).toBeUndefined()
    expect(rule.exclude).toBeUndefined()

    const [loaderPlugin, flagsPlugin] = result?.plugins || []
    expect(loaderPlugin).toBeInstanceOf(
      fromDevelop('vue-loader').VueLoaderPlugin
    )

    expect(flagsPlugin).toBeInstanceOf(VueFeatureFlagsPlugin)
    expect((flagsPlugin as unknown as VueFeatureFlagsPlugin).flags).toEqual({
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'true',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true'
    })

    const esm = (name: string) =>
      path.join(root, 'node_modules', name, 'dist', 'esm-bundler.js')
    expect(result?.alias).toEqual({
      vue$: esm('vue'),
      '@vue/runtime-dom': esm('@vue/runtime-dom'),
      '@vue/runtime-core': esm('@vue/runtime-core'),
      '@vue/shared': esm('@vue/shared')
    })
  })

  it('turns the production devtools flags off in a production build', async () => {
    const result = await maybeUseVue(vueThreeProject(), 'production')
    const flagsPlugin = result?.plugins?.[1] as unknown as VueFeatureFlagsPlugin

    expect(flagsPlugin.flags).toEqual({
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
    })
  })

  it('keeps the nested loader option defaults', async () => {
    const root = vueThreeProject({
      'vue.loader.mjs':
        "export default {compilerOptions: {whitespace: 'preserve'}}\n"
    })
    const result = await maybeUseVue(root, 'development')
    const rule = result?.loaders?.[0] as {options: Record<string, unknown>}

    expect(rule.options).toEqual({
      experimentalInlineMatchResource: true,
      compilerOptions: {whitespace: 'preserve'}
    })
  })

  it('returns undefined when vue is not a dependency', async () => {
    expect(await maybeUseVue(makeProject({'package.json': {}}))).toBeUndefined()
  })
})

describe('Vue 2', () => {
  // No vue-loader in the result is how the Vue 2 branch shows: the Vue 3
  // branch always returns the vue-loader rule and VueLoaderPlugin.
  it('builds a Vue 2 project without vue-loader instead of refusing it', async () => {
    const {root, vueDir} = vueTwoProject()
    const result = await maybeUseVue(root)

    expect(result?.alias).toEqual({
      vue$: path.join(vueDir, 'dist', 'vue.runtime.esm.js')
    })

    expect(result?.loaders).toEqual([{test: /\.vue$/, type: 'asset/source'}])
    expect(result?.plugins).toHaveLength(1)

    const errors = finishModules(result?.plugins?.[0], root, [
      {resource: path.join(root, 'src', 'main.js'), type: 'javascript/auto'}
    ])

    expect(errors).toEqual([])
  })

  it('refuses a Vue 2 single-file component once, by file, with no stack', async () => {
    const {root} = vueTwoProject()
    const result = await maybeUseVue(root)
    const errors = finishModules(result?.plugins?.[0], root, [
      {resource: path.join(root, 'src', 'main.js'), type: 'javascript/auto'},
      {resource: path.join(root, 'src', 'B.vue'), type: 'asset/source'},
      {resource: path.join(root, 'src', 'A.vue?x=1'), type: 'asset/source'}
    ])

    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(
      /Vue 2\.7\.16 is installed, and Extension\.js compiles \.vue files for Vue 3 only/
    )

    expect(errors[0].message).toContain(path.join(root, 'src', 'A.vue'))
    expect(errors[0].message).toContain(path.join(root, 'src', 'B.vue'))
    expect(errors[0].file).toBe(path.join('src', 'A.vue'))
    expect(errors[0].stack).toBe('')
  })

  it('leaves a .vue file the project compiles with its own loader alone', async () => {
    const {root} = vueTwoProject()
    const result = await maybeUseVue(root)
    const errors = finishModules(result?.plugins?.[0], root, [
      {resource: path.join(root, 'src', 'A.vue'), type: 'javascript/auto'}
    ])

    expect(errors).toEqual([])
  })
})

describe('resolveVueBundlerEntry', () => {
  function project(vueManifest: Record<string, unknown>, files: string[]) {
    const root = makeProject({'package.json': {name: 'app'}})
    fakePackage(
      root,
      'vue',
      vueManifest,
      Object.fromEntries(files.map((file) => [file, '']))
    )

    return createRequire(path.join(root, 'package.json'))
  }

  it('picks the runtime ESM build named by package.json module', () => {
    const req = project(
      {main: 'index.js', module: 'dist/vue.runtime.esm-bundler.js'},
      ['index.js', 'dist/vue.runtime.esm-bundler.js']
    )

    expect(resolveVueBundlerEntry(req, 'vue')).toBe(
      path.join(
        path.dirname(req.resolve('vue/package.json')),
        'dist',
        'vue.runtime.esm-bundler.js'
      )
    )
  })

  it('falls back to the main entry when module is missing or absent on disk', () => {
    const req = project({main: 'index.js', module: 'dist/gone.js'}, [
      'index.js'
    ])

    expect(resolveVueBundlerEntry(req, 'vue')).toBe(
      path.join(path.dirname(req.resolve('vue/package.json')), 'index.js')
    )

    expect(resolveVueBundlerEntry(req, 'not-installed')).toBeUndefined()
  })
})

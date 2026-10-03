import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
}))

const originalResolve = (require as any).resolve
beforeEach(() => {
  ;(require as any).resolve = vi.fn((id: string) =>
    id === 'vue-loader' ? '/mock/vue-loader' : originalResolve(id)
  )
})

afterEach(() => {
  ;(require as any).resolve = originalResolve
})

describe('vue tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingVue logs once; maybeUseVue returns default loader and plugin; merges custom options', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'vue'
    )

    vi.doMock('../../js-frameworks-lib/load-loader-options', async () => ({
      ...(await vi.importActual('../../js-frameworks-lib/load-loader-options')),
      loadLoaderOptions: vi.fn(async () => ({foo: 1}))
    }))

    const VueLoaderPluginMock = function (this: any) {
      this.apply = vi.fn()
    } as any
    vi.doMock('module', () => ({
      createRequire: () => {
        const req = ((id: string) => {
          if (id === 'vue-loader') {
            return {VueLoaderPlugin: VueLoaderPluginMock}
          }

          if (id === '@vue/compiler-sfc') {
            return {parse: vi.fn()}
          }

          if (id === 'vue') {
            return {version: '3.5.0'}
          }

          throw new Error(`Cannot find module ${id}`)
        }) as any
        req.resolve = (id: string) => `/project/node_modules/${id}`

        return req
      }
    }))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingVue, maybeUseVue} = await import('../../js-tools/vue')

    expect(isUsingVue('/p')).toBe(true)
    expect(isUsingVue('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)

    const result = await maybeUseVue('/p', 'development')
    expect(result?.loaders?.[0].test).toEqual(/\.vue$/)
    expect(result?.loaders?.[0].options).toMatchObject({foo: 1})
    expect(result?.loaders?.[0].include).toBeUndefined()

    const exclude = result?.loaders?.[0].exclude as (p: string) => boolean
    expect(exclude('/p/src/App.vue')).toBe(false)
    expect(exclude('/p/node_modules/other-lib/Button.vue')).toBe(true)
    expect(result?.plugins?.length).toBeGreaterThan(0)
    expect(result?.alias?.vue$).toContain('/project/node_modules/vue')
    expect(result?.alias?.['@vue/runtime-dom']).toContain(
      '/project/node_modules/@vue/runtime-dom'
    )

    expect(result?.alias?.['@vue/runtime-core']).toContain(
      '/project/node_modules/@vue/runtime-core'
    )

    expect(result?.alias?.['@vue/shared']).toContain(
      '/project/node_modules/@vue/shared'
    )
  })

  it('compiles an SFC from a transpiled package and keeps the nested defaults', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'vue'
    )

    vi.doMock('../../js-frameworks-lib/load-loader-options', async () => ({
      ...(await vi.importActual('../../js-frameworks-lib/load-loader-options')),
      loadLoaderOptions: vi.fn(async () => ({
        compilerOptions: {whitespace: 'preserve'}
      }))
    }))

    const VueLoaderPluginMock = function (this: any) {
      this.apply = vi.fn()
    } as any
    vi.doMock('module', () => ({
      createRequire: () => {
        const req = ((id: string) => {
          if (id === 'vue-loader') {
            return {VueLoaderPlugin: VueLoaderPluginMock}
          }

          if (id === '@vue/compiler-sfc') return {parse: vi.fn()}
          if (id === 'vue') return {version: '3.5.0'}

          throw new Error(`Cannot find module ${id}`)
        }) as any
        req.resolve = (id: string) => `/project/node_modules/${id}`

        return req
      }
    }))

    vi.spyOn(console, 'log').mockImplementation(() => {})
    const {maybeUseVue} = await import('../../js-tools/vue')
    const result = await maybeUseVue('/p', 'development', [
      '/p/node_modules/acme-ui'
    ])
    const rule = result?.loaders?.[0] as any

    expect(rule.options.experimentalInlineMatchResource).toBe(true)
    expect(rule.options.compilerOptions).toEqual({whitespace: 'preserve'})
    expect(rule.exclude('/p/node_modules/acme-ui/Button.vue')).toBe(false)
    expect(rule.exclude('/p/node_modules/other-lib/Button.vue')).toBe(true)
  })
})

describe('resolveVueBundlerEntry', () => {
  function fakeProject(vueManifest: Record<string, unknown>, files: string[]) {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-vue-entry-'))
    )
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"app"}')
    const vueDir = path.join(root, 'node_modules', 'vue')

    for (const rel of files) {
      fs.mkdirSync(path.dirname(path.join(vueDir, rel)), {recursive: true})
      fs.writeFileSync(path.join(vueDir, rel), '')
    }

    fs.writeFileSync(
      path.join(vueDir, 'package.json'),
      JSON.stringify({name: 'vue', ...vueManifest})
    )

    return root
  }

  beforeEach(() => {
    vi.doUnmock('module')
    vi.resetModules()
  })

  async function loadVueTwoProject() {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'vue'
    )

    const resolver = {
      ensureOptionalContractPackageResolved: vi.fn(),
      ensureOptionalContractModuleLoaded: vi.fn()
    }
    vi.doMock('../../../lib/optional-deps-resolver', () => resolver)

    const projectPath = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-vue2-'))
    )
    const vueDir = path.join(projectPath, 'node_modules', 'vue')
    fs.mkdirSync(path.join(vueDir, 'dist'), {recursive: true})
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({name: 'vue2-fixture', dependencies: {vue: '^2.7.16'}})
    )

    fs.writeFileSync(
      path.join(vueDir, 'package.json'),
      JSON.stringify({
        name: 'vue',
        version: '2.7.16',
        main: 'index.js',
        module: 'dist/vue.runtime.esm.js'
      })
    )

    fs.writeFileSync(path.join(vueDir, 'index.js'), '')
    fs.writeFileSync(path.join(vueDir, 'dist', 'vue.runtime.esm.js'), '')

    const {maybeUseVue} = await import('../../js-tools/vue')

    return {
      projectPath,
      vueDir,
      resolver,
      result: await maybeUseVue(projectPath)
    }
  }

  // The two hooks the refusal taps, run by hand over a list of modules.
  function finishModules(plugin: any, context: string, modules: unknown[]) {
    const errors: Array<Error & {file?: string}> = []
    const compilation = {
      errors,
      hooks: {
        finishModules: {
          tap: (_name: string, fn: (m: unknown[]) => void) => fn(modules)
        }
      }
    }

    plugin.apply({
      context,
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: (c: unknown) => void) => fn(compilation)
        }
      }
    })

    return errors
  }

  it('builds a Vue 2 project without vue-loader instead of refusing it', async () => {
    const {projectPath, vueDir, resolver, result} = await loadVueTwoProject()

    try {
      expect(
        resolver.ensureOptionalContractPackageResolved
      ).not.toHaveBeenCalled()

      expect(resolver.ensureOptionalContractModuleLoaded).not.toHaveBeenCalled()

      expect(result?.alias).toEqual({
        vue$: path.join(vueDir, 'dist', 'vue.runtime.esm.js')
      })

      expect(result?.loaders).toEqual([{test: /\.vue$/, type: 'asset/source'}])
      expect(result?.plugins).toHaveLength(1)

      const errors = finishModules(result?.plugins?.[0], projectPath, [
        {
          resource: path.join(projectPath, 'src', 'main.js'),
          type: 'javascript/auto'
        }
      ])

      expect(errors).toEqual([])
    } finally {
      fs.rmSync(projectPath, {recursive: true, force: true})
    }
  })

  it('refuses a Vue 2 single-file component once, by file, with no stack', async () => {
    const {projectPath, result} = await loadVueTwoProject()

    try {
      const errors = finishModules(result?.plugins?.[0], projectPath, [
        {
          resource: path.join(projectPath, 'src', 'main.js'),
          type: 'javascript/auto'
        },
        {
          resource: path.join(projectPath, 'src', 'B.vue'),
          type: 'asset/source'
        },
        {
          resource: path.join(projectPath, 'src', 'A.vue?x=1'),
          type: 'asset/source'
        }
      ])

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toMatch(
        /Vue 2\.7\.16 is installed, and Extension\.js compiles \.vue files for Vue 3 only/
      )

      expect(errors[0].message).toContain(
        path.join(projectPath, 'src', 'A.vue')
      )

      expect(errors[0].message).toContain(
        path.join(projectPath, 'src', 'B.vue')
      )

      expect(errors[0].file).toBe(path.join('src', 'A.vue'))
      expect(errors[0].stack).toBe('')
    } finally {
      fs.rmSync(projectPath, {recursive: true, force: true})
    }
  })

  it('leaves a .vue file the project compiles with its own loader alone', async () => {
    const {projectPath, result} = await loadVueTwoProject()

    try {
      const errors = finishModules(result?.plugins?.[0], projectPath, [
        {
          resource: path.join(projectPath, 'src', 'A.vue'),
          type: 'javascript/auto'
        }
      ])

      expect(errors).toEqual([])
    } finally {
      fs.rmSync(projectPath, {recursive: true, force: true})
    }
  })

  it('picks the runtime ESM build named by package.json module', async () => {
    const root = fakeProject(
      {main: 'index.js', module: 'dist/vue.runtime.esm-bundler.js'},
      ['index.js', 'dist/vue.runtime.esm-bundler.js']
    )
    const {resolveVueBundlerEntry} = await import('../../js-tools/vue')
    const req = createRequire(path.join(root, 'package.json'))
    expect(resolveVueBundlerEntry(req, 'vue')).toBe(
      path.join(
        root,
        'node_modules',
        'vue',
        'dist',
        'vue.runtime.esm-bundler.js'
      )
    )

    fs.rmSync(root, {recursive: true, force: true})
  })

  it('falls back to the main entry when module is missing or absent on disk', async () => {
    const root = fakeProject({main: 'index.js', module: 'dist/gone.js'}, [
      'index.js'
    ])
    const {resolveVueBundlerEntry} = await import('../../js-tools/vue')
    const req = createRequire(path.join(root, 'package.json'))
    expect(resolveVueBundlerEntry(req, 'vue')).toBe(
      path.join(root, 'node_modules', 'vue', 'index.js')
    )

    expect(resolveVueBundlerEntry(req, 'not-installed')).toBeUndefined()
    fs.rmSync(root, {recursive: true, force: true})
  })
})

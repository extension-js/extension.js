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

    vi.doMock('../../js-frameworks-lib/load-loader-options', () => ({
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
    expect(result?.loaders?.[0].options?.foo).toBe(1)
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

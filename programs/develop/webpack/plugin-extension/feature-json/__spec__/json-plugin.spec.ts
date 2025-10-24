import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))
import * as fs from 'fs'
import * as messages from '../messages'
import {JsonPlugin} from '../index'

function createCompilerHarness() {
  const thisCompilationCallbacks: Array<(compilation: any) => void> = []
  const processAssetsCallbacks: Array<() => void> = []

  const assets: Record<string, string> = {}
  const calls = {emit: 0, update: 0}

  const compilation: any = {
    hooks: {
      processAssets: {
        tap(_opts: any, cb: () => void) {
          processAssetsCallbacks.push(cb)
        }
      }
    },
    emitAsset(name: string, source: any) {
      calls.emit++
      const value =
        typeof source?.source === 'function' ? source.source() : source
      assets[name] = value?.toString?.() ?? String(value)
    },
    updateAsset(name: string, source: any) {
      calls.update++
      const value =
        typeof source?.source === 'function' ? source.source() : source
      assets[name] = value?.toString?.() ?? String(value)
    },
    getAsset(name: string) {
      return assets[name] ? {name} : undefined
    },
    errors: [] as any[],
    warnings: [] as Array<{message?: string}>,
    fileDependencies: new Set<string>()
  }

  const compiler: any = {
    hooks: {
      thisCompilation: {
        tap(_name: string, fn: (compilation: any) => void) {
          thisCompilationCallbacks.push(fn)
        }
      }
    }
  }

  function applyAndRun(plugin: JsonPlugin) {
    plugin.apply(compiler)
    // simulate rspack/webpack lifecycle synchronously
    for (const cb of thisCompilationCallbacks) cb(compilation)
    for (const cb of processAssetsCallbacks) cb()
    return {assets, compilation, calls}
  }

  return {compiler, compilation, assets, calls, applyAndRun}
}

describe('JsonPlugin', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('emits asset for existing JSON resource', () => {
    const jsonPath = '/abs/path/rules.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockImplementation((p: any) => p === jsonPath)
    mockedFs.readFileSync.mockImplementation((p: any) =>
      p === jsonPath ? Buffer.from('{"ok":true}') : Buffer.from('')
    )

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['declarative_net_request.ruleset']: jsonPath}
    } as any)
    const harness = createCompilerHarness()
    const {assets, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(1)
    expect(Object.keys(assets)).toContain(
      'declarative_net_request.ruleset.json'
    )
    expect(assets['declarative_net_request.ruleset.json']).toBe('{"ok":true}')
  })

  it('updates asset when multiple resources map to the same feature (array)', () => {
    const p1 = '/abs/path/schema-1.json'
    const p2 = '/abs/path/schema-2.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockImplementation((p: any) => p === p1 || p === p2)
    mockedFs.readFileSync.mockImplementation((p: any) =>
      p === p1 ? Buffer.from('{"v":1}') : Buffer.from('{"v":2}')
    )

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['storage.managed_schema']: [p1, p2]}
    } as any)
    const harness = createCompilerHarness()
    const {assets, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(1)
    expect(calls.update).toBe(1)
    expect(assets['storage.managed_schema.json']).toBe('{"v":2}')
  })

  it('pushes a warning when file is missing', () => {
    const missing = '/abs/path/missing.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockReturnValue(false)

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['declarative_net_request.ruleset']: missing}
    } as any)
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.warnings.length).toBe(1)
    const expected = messages.entryNotFoundMessageOnly(
      'declarative_net_request.ruleset'
    )
    expect(compilation.warnings[0]?.message).toContain(expected)
  })

  it('respects excludeList via shouldExclude()', () => {
    const p = '/abs/path/ignored.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(Buffer.from('{}'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['storage.managed_schema']: p},
      excludeList: {excluded: p}
    } as any)
    const harness = createCompilerHarness()
    const {assets, compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)
    expect(compilation.fileDependencies.size).toBe(0)
  })

  it('adds fileDependencies for existing resources', () => {
    const p = '/abs/path/watch.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockImplementation((x: any) => x === p)
    mockedFs.readFileSync.mockReturnValue(Buffer.from('{}'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['storage.managed_schema']: p}
    } as any)
    const harness = createCompilerHarness()
    const {compilation} = harness.applyAndRun(plugin)

    expect(compilation.fileDependencies.has(p)).toBe(true)
  })

  it('skips processing when compilation has errors', () => {
    const p = '/abs/path/wont-run.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(Buffer.from('{}'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['storage.managed_schema']: p}
    } as any)
    const harness = createCompilerHarness()
    // inject an error before running processAssets
    harness.compilation.errors.push(new Error('stop'))
    const {assets, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)
    expect(harness.compilation.fileDependencies.size).toBe(0)
  })
})

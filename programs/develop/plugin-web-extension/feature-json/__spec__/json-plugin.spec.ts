import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))
import * as fs from 'fs'
import * as path from 'path'
import * as messages from '../messages'
import {JsonPlugin} from '../index'

function createCompilerHarness() {
  const thisCompilationCallbacks: Array<(compilation: any) => void> = []
  const processAssetsCallbacks: Array<() => void> = []

  const assets: Record<string, string> = {}
  const calls = {emit: 0, update: 0}

  const compilation: any = {
    // The implementation expects a Compilation-like object with a compiler
    // and compiler options/context. Unit tests will wire these up in applyAndRun.
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
    // Provide a minimal Compilation/Compiler relationship expected by the plugin code.
    const context = path.dirname(
      (plugin as any).manifestPath || 'manifest.json'
    )
    compiler.options = {context}
    compilation.compiler = compiler
    compilation.options = {context}

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
      p === jsonPath ? Buffer.from('[]') : Buffer.from('')
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
    expect(assets['declarative_net_request.ruleset.json']).toBe('[]')
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

  it('errors when file is missing for critical JSON features', () => {
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
    expect(compilation.errors.length).toBe(1)
    const expected = messages.jsonMissingFile(
      'declarative_net_request.ruleset',
      missing
    )
    expect(compilation.errors[0]?.message).toContain(expected)
    expect((compilation.errors[0] as any)?.name).toBe('JSONMissingFile')
    expect((compilation.errors[0] as any)?.file).toBe('manifest.json')
  })

  it('errors when JSON is invalid for DNR ruleset', () => {
    const p = '/abs/path/rules.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockImplementation((x: any) => x === p)
    mockedFs.readFileSync.mockImplementation(() => Buffer.from('{invalid'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['declarative_net_request.ruleset']: p}
    } as any)
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    expect((compilation.errors[0] as any)?.name).toBe('JSONInvalidSyntax')
  })

  it('errors when DNR ruleset is not an array', () => {
    const p = '/abs/path/rules.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockImplementation((x: any) => x === p)
    mockedFs.readFileSync.mockImplementation(() => Buffer.from('{}'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['declarative_net_request.ruleset']: p}
    } as any)
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    expect((compilation.errors[0] as any)?.name).toBe('DNRInvalidRuleset')
  })

  it('errors when managed schema is not an object', () => {
    const p = '/abs/path/schema.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockImplementation((x: any) => x === p)
    mockedFs.readFileSync.mockImplementation(() => Buffer.from('[]'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['storage.managed_schema']: p}
    } as any)
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    expect((compilation.errors[0] as any)?.name).toBe('ManagedSchemaInvalid')
  })

  it('does not emit assets for public dir resources; watches and validates critical JSON', () => {
    const projectRoot = '/abs/project'
    const manifestPath = path.join(projectRoot, 'manifest.json')
    const rel = 'public/rules.json'
    const abs = path.join(projectRoot, rel)

    const mockedFs = fs as any
    mockedFs.existsSync.mockImplementation((p: any) => p === abs)
    // Valid DNR ruleset (array)
    mockedFs.readFileSync.mockImplementation((p: any) =>
      p === abs ? Buffer.from('[]') : Buffer.from('')
    )

    const plugin = new JsonPlugin({
      manifestPath,
      includeList: {['declarative_net_request.ruleset']: rel}
    } as any)
    const harness = createCompilerHarness()
    const {assets, compilation, calls} = harness.applyAndRun(plugin)

    // No emit/update because file is under public/
    expect(calls.emit).toBe(0)
    expect(calls.update).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)

    // File is watched
    expect(compilation.fileDependencies.has(abs)).toBe(true)

    // No validation errors for a valid ruleset
    expect(compilation.errors.length).toBe(0)
  })

  it('emits an error for invalid JSON under public dir for DNR ruleset', () => {
    const projectRoot = '/abs/project'
    const manifestPath = path.join(projectRoot, 'manifest.json')
    const rel = 'public/badrules.json'
    const abs = path.join(projectRoot, rel)

    const mockedFs = fs as any
    mockedFs.existsSync.mockImplementation((p: any) => p === abs)
    // Invalid JSON
    mockedFs.readFileSync.mockImplementation((p: any) =>
      p === abs ? Buffer.from('{ invalid') : Buffer.from('')
    )

    const plugin = new JsonPlugin({
      manifestPath,
      includeList: {['declarative_net_request.ruleset']: rel}
    } as any)
    const harness = createCompilerHarness()
    const {assets, compilation, calls} = harness.applyAndRun(plugin)

    // No emit/update because file is under public/
    expect(calls.emit).toBe(0)
    expect(calls.update).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)

    // File is watched
    expect(compilation.fileDependencies.has(abs)).toBe(true)

    // Validation error should be present
    expect(compilation.errors.length).toBe(1)
    expect((compilation.errors[0] as any)?.name).toBe('JSONInvalidSyntax')
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

  it('warns (not errors) when a non-critical JSON file is missing', () => {
    const missingPath = '/abs/path/missing.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockReturnValue(false)

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['custom.feature']: missingPath}
    } as any)
    const harness = createCompilerHarness()
    const {compilation, calls, assets} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)
    expect(compilation.errors.length).toBe(0)
    expect(compilation.warnings.length).toBe(1)
    const warn: any = compilation.warnings[0]
    expect(warn.name).toBe('JSONMissingFile')
  })

  it('errors when managed schema JSON has invalid syntax', () => {
    const schemaPath = '/abs/path/managed_schema.json'
    const mockedFs = fs as any
    mockedFs.existsSync.mockImplementation((p: any) => p === schemaPath)
    mockedFs.readFileSync.mockImplementation(() => Buffer.from('{ invalid'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {['storage.managed_schema']: schemaPath}
    } as any)
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    expect((compilation.errors[0] as any)?.name).toBe('JSONInvalidSyntax')
  })
})

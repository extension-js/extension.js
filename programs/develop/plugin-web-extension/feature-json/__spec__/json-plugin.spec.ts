import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi
} from 'vitest'

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))

// The paths here are imaginary, so a file may ship when the fake disk has
// it. Whole builds in json-private-sources.spec.ts run the real answer.
vi.mock('../../../lib/public-private-files', async () => ({
  ...(await vi.importActual<object>('../../../lib/public-private-files')),
  sourceFileMayShip: (file: string) => fs.existsSync(file)
}))

import * as fs from 'node:fs'
import * as path from 'node:path'
import {asCompiler} from '../../__spec__/helpers/rspack-fakes'
import {JsonPlugin} from '../index'
import * as messages from '../messages'

// The fs mock above swaps these two for spies.
const mockedFs = fs as unknown as {
  existsSync: Mock<(file: unknown) => boolean>
  readFileSync: Mock<(file: unknown) => Buffer>
}

type FakeAsset = unknown

function assetText(source: FakeAsset) {
  const readable = source as {source?: () => unknown} | null
  const value =
    typeof readable?.source === 'function' ? readable.source() : source

  return (
    (value as {toString?: () => string} | null)?.toString?.() ?? String(value)
  )
}

function createCompilerHarness() {
  const thisCompilationCallbacks: Array<(compilation: unknown) => void> = []
  const processAssetsCallbacks: Array<() => void> = []

  const assets: Record<string, string> = {}
  const calls = {emit: 0, update: 0}

  const compilation = {
    hooks: {
      processAssets: {
        tap(_opts: unknown, cb: () => void) {
          processAssetsCallbacks.push(cb)
        }
      }
    },
    emitAsset(name: string, source: FakeAsset) {
      calls.emit++
      assets[name] = assetText(source)
    },
    updateAsset(name: string, source: FakeAsset) {
      calls.update++
      assets[name] = assetText(source)
    },
    getAsset(name: string) {
      return assets[name] ? {name} : undefined
    },
    errors: [] as Array<Error & {file?: string}>,
    warnings: [] as Array<{message?: string; name?: string}>,
    fileDependencies: new Set<string>(),
    missingDependencies: undefined as Set<string> | undefined,
    compiler: undefined as unknown,
    options: undefined as {context: string} | undefined
  }

  const compiler = {
    options: undefined as {context: string} | undefined,
    hooks: {
      thisCompilation: {
        tap(_name: string, fn: (compilation: unknown) => void) {
          thisCompilationCallbacks.push(fn)
        }
      }
    }
  }

  function applyAndRun(plugin: JsonPlugin) {
    const context = path.dirname(plugin.manifestPath || 'manifest.json')
    compiler.options = {context}
    compilation.compiler = compiler
    compilation.options = {context}

    plugin.apply(asCompiler(compiler))
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
    mockedFs.existsSync.mockImplementation((p: unknown) => p === jsonPath)
    mockedFs.readFileSync.mockImplementation((p: unknown) =>
      p === jsonPath ? Buffer.from('[]') : Buffer.from('')
    )

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'declarative_net_request.ruleset': jsonPath}
    })
    const harness = createCompilerHarness()
    const {assets, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(1)
    expect(Object.keys(assets)).toContain(
      'declarative_net_request.ruleset.json'
    )

    expect(assets['declarative_net_request.ruleset.json']).toBe('[]')
  })

  it('refuses a key whose value is a list of files, naming the key', () => {
    const p1 = '/abs/path/schema-1.json'
    const p2 = '/abs/path/schema-2.json'

    expect(
      () =>
        new JsonPlugin({
          manifestPath: 'manifest.json',
          // @ts-expect-error a list of files proves the runtime guard
          includeList: {'storage/managed_schema': [p1, p2]}
        })
    ).toThrow(
      'JsonPlugin takes one file path per key, and the key storage/managed_schema has a list.'
    )
  })

  it('refuses a key whose value is not a string', () => {
    expect(
      () =>
        new JsonPlugin({
          manifestPath: 'manifest.json',
          // @ts-expect-error an object value proves the runtime guard
          includeList: {'storage/managed_schema': {path: '/abs/schema.json'}}
        })
    ).toThrow(TypeError)
  })

  it('takes a key with no value and writes nothing for it', () => {
    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'storage/managed_schema': undefined}
    })
    const {assets, compilation} = createCompilerHarness().applyAndRun(plugin)

    expect(assets).toEqual({})
    expect(compilation.errors).toEqual([])
    expect(compilation.warnings).toEqual([])
  })

  it('errors when a leading-slash critical JSON ref is missing from public/', () => {
    const projectRoot = '/abs/project'
    const manifestPath = path.join(projectRoot, 'manifest.json')
    mockedFs.existsSync.mockReturnValue(false)

    const plugin = new JsonPlugin({
      manifestPath,
      includeList: {'declarative_net_request.ruleset': '/rules.json'}
    })
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    expect(compilation.errors[0]?.name).toBe('JSONMissingFile')
    expect(compilation.errors[0]?.message).toContain(
      "A path starting with '/' resolves from the extension root"
    )
  })

  it('errors when file is missing for critical JSON features', () => {
    const missing = '/abs/path/missing.json'
    mockedFs.existsSync.mockReturnValue(false)

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'declarative_net_request.ruleset': missing}
    })
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    const expected = messages.jsonMissingFile(
      'declarative_net_request.ruleset',
      missing,
      {fatal: true}
    )
    expect(compilation.errors[0]?.message).toContain(expected)
    expect(compilation.errors[0]?.name).toBe('JSONMissingFile')
    expect(compilation.errors[0]?.file).toBe('manifest.json')
  })

  it('warns for a missing non-critical JSON file without promising a failure', () => {
    const missing = '/abs/path/missing.json'
    mockedFs.existsSync.mockReturnValue(false)

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'side_panel.default_path': missing}
    })
    const harness = createCompilerHarness()
    const {compilation} = harness.applyAndRun(plugin)

    expect(compilation.errors.length).toBe(0)
    expect(compilation.warnings.length).toBe(1)
    expect(compilation.warnings[0]?.message).toContain('The build continues.')
    expect(compilation.warnings[0]?.message).not.toContain(
      'We fail the build early'
    )
  })

  it('accepts a DNR ruleset with a UTF-8 BOM, as Chrome does (G22)', () => {
    const p = '/abs/path/rules.json'
    mockedFs.existsSync.mockImplementation((x: unknown) => x === p)
    mockedFs.readFileSync.mockImplementation(() =>
      Buffer.from(
        '\uFEFF[{"id":1,"priority":1,"action":{"type":"block"},"condition":{"urlFilter":"ads"}}]',
        'utf8'
      )
    )

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'declarative_net_request.ruleset': p}
    })
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(compilation.errors.length).toBe(0)
    expect(calls.emit).toBe(1)
  })

  it('errors when JSON is invalid for DNR ruleset', () => {
    const p = '/abs/path/rules.json'
    mockedFs.existsSync.mockImplementation((x: unknown) => x === p)
    mockedFs.readFileSync.mockImplementation(() => Buffer.from('{invalid'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'declarative_net_request.ruleset': p}
    })
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    expect(compilation.errors[0]?.name).toBe('JSONInvalidSyntax')
  })

  it('names where a DNR ruleset stops parsing and quotes none of it', () => {
    const p = '/abs/path/rules.json'
    const secret = 'root:x:0:0:secret-hunter2'
    mockedFs.existsSync.mockImplementation((x: unknown) => x === p)
    mockedFs.readFileSync.mockImplementation(() => Buffer.from(secret))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'declarative_net_request.ruleset': p}
    })
    const {compilation} = createCompilerHarness().applyAndRun(plugin)
    const message = String(compilation.errors[0]?.message)

    expect(message).toContain('unexpected character at line 1 column 1')

    for (let i = 0; i + 4 <= secret.length; i++) {
      expect(message).not.toContain(secret.slice(i, i + 4))
    }
  })

  it('errors when DNR ruleset is not an array', () => {
    const p = '/abs/path/rules.json'
    mockedFs.existsSync.mockImplementation((x: unknown) => x === p)
    mockedFs.readFileSync.mockImplementation(() => Buffer.from('{}'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'declarative_net_request.ruleset': p}
    })
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    expect(compilation.errors[0]?.name).toBe('DNRInvalidRuleset')
  })

  it('errors when managed schema is not an object', () => {
    const p = '/abs/path/schema.json'
    mockedFs.existsSync.mockImplementation((x: unknown) => x === p)
    mockedFs.readFileSync.mockImplementation(() => Buffer.from('[]'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'storage/managed_schema': p}
    })
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    expect(compilation.errors[0]?.name).toBe('ManagedSchemaInvalid')
  })

  it('does not emit or fail for a leading-slash JSON ref that public/ owns', () => {
    const projectRoot = '/abs/project'
    const manifestPath = path.join(projectRoot, 'manifest.json')
    const publicAbs = path.join(projectRoot, 'public', 'rules.json')

    mockedFs.existsSync.mockImplementation((p: unknown) => p === publicAbs)
    mockedFs.readFileSync.mockImplementation((p: unknown) =>
      p === publicAbs ? Buffer.from('[]') : Buffer.from('')
    )

    const plugin = new JsonPlugin({
      manifestPath,
      includeList: {'declarative_net_request.ruleset': '/rules.json'}
    })
    const harness = createCompilerHarness()
    const {assets, compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)
    expect(compilation.fileDependencies.has(publicAbs)).toBe(true)
    expect(compilation.errors.length).toBe(0)
  })

  it('resolves includeList project-root paths to public/ when that is where the file lives', () => {
    const projectRoot = '/abs/project'
    const manifestPath = path.join(projectRoot, 'manifest.json')
    const resolved = path.join(projectRoot, 'rules.json')
    const publicAbs = path.join(projectRoot, 'public', 'rules.json')

    mockedFs.existsSync.mockImplementation((p: unknown) => p === publicAbs)
    mockedFs.readFileSync.mockImplementation((p: unknown) =>
      p === publicAbs ? Buffer.from('[]') : Buffer.from('')
    )

    const plugin = new JsonPlugin({
      manifestPath,
      includeList: {'declarative_net_request.ruleset': resolved}
    })
    const harness = createCompilerHarness()
    const {assets, compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)
    expect(compilation.fileDependencies.has(publicAbs)).toBe(true)
    expect(compilation.errors.length).toBe(0)
  })

  it('does not emit assets for public dir resources; watches and validates critical JSON', () => {
    const projectRoot = '/abs/project'
    const manifestPath = path.join(projectRoot, 'manifest.json')
    const rel = 'public/rules.json'
    const abs = path.join(projectRoot, rel)

    mockedFs.existsSync.mockImplementation((p: unknown) => p === abs)
    mockedFs.readFileSync.mockImplementation((p: unknown) =>
      p === abs ? Buffer.from('[]') : Buffer.from('')
    )

    const plugin = new JsonPlugin({
      manifestPath,
      includeList: {'declarative_net_request.ruleset': rel}
    })
    const harness = createCompilerHarness()
    const {assets, compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(calls.update).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)

    expect(compilation.fileDependencies.has(abs)).toBe(true)

    expect(compilation.errors.length).toBe(0)
  })

  it('emits an error for invalid JSON under public dir for DNR ruleset', () => {
    const projectRoot = '/abs/project'
    const manifestPath = path.join(projectRoot, 'manifest.json')
    const rel = 'public/badrules.json'
    const abs = path.join(projectRoot, rel)

    mockedFs.existsSync.mockImplementation((p: unknown) => p === abs)
    mockedFs.readFileSync.mockImplementation((p: unknown) =>
      p === abs ? Buffer.from('{ invalid') : Buffer.from('')
    )

    const plugin = new JsonPlugin({
      manifestPath,
      includeList: {'declarative_net_request.ruleset': rel}
    })
    const harness = createCompilerHarness()
    const {assets, compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(calls.update).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)

    expect(compilation.fileDependencies.has(abs)).toBe(true)

    expect(compilation.errors.length).toBe(1)
    expect(compilation.errors[0]?.name).toBe('JSONInvalidSyntax')
  })

  it('adds fileDependencies for existing resources', () => {
    const p = '/abs/path/watch.json'
    mockedFs.existsSync.mockImplementation((x: unknown) => x === p)
    mockedFs.readFileSync.mockReturnValue(Buffer.from('{}'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'storage/managed_schema': p}
    })
    const harness = createCompilerHarness()
    const {compilation} = harness.applyAndRun(plugin)

    expect(compilation.fileDependencies.has(p)).toBe(true)
  })

  it('skips emission but keeps tracking when compilation has errors', () => {
    const p = '/abs/path/wont-run.json'
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(Buffer.from('{}'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'storage/managed_schema': p}
    })
    const harness = createCompilerHarness()
    harness.compilation.errors.push(new Error('stop'))
    const {assets, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)
    // The file is still watched: fixing it must rebuild without a restart.
    expect(harness.compilation.fileDependencies.has(p)).toBe(true)
  })

  it('remembers a missing JSON file so its arrival rebuilds', () => {
    const missing = '/abs/path/not-yet.json'
    mockedFs.existsSync.mockReturnValue(false)

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'custom.feature': missing}
    })
    const harness = createCompilerHarness()
    harness.compilation.missingDependencies = new Set<string>()
    harness.applyAndRun(plugin)

    expect(harness.compilation.missingDependencies?.has(missing)).toBe(true)
  })

  it('warns (not errors) when a non-critical JSON file is missing', () => {
    const missingPath = '/abs/path/missing.json'
    mockedFs.existsSync.mockReturnValue(false)

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'custom.feature': missingPath}
    })
    const harness = createCompilerHarness()
    const {compilation, calls, assets} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(Object.keys(assets)).toHaveLength(0)
    expect(compilation.errors.length).toBe(0)
    expect(compilation.warnings.length).toBe(1)
    const warn = compilation.warnings[0]
    expect(warn.name).toBe('JSONMissingFile')
  })

  it('errors when managed schema JSON has invalid syntax', () => {
    const schemaPath = '/abs/path/managed_schema.json'
    mockedFs.existsSync.mockImplementation((p: unknown) => p === schemaPath)
    mockedFs.readFileSync.mockImplementation(() => Buffer.from('{ invalid'))

    const plugin = new JsonPlugin({
      manifestPath: 'manifest.json',
      includeList: {'storage/managed_schema': schemaPath}
    })
    const harness = createCompilerHarness()
    const {compilation, calls} = harness.applyAndRun(plugin)

    expect(calls.emit).toBe(0)
    expect(compilation.errors.length).toBe(1)
    expect(compilation.errors[0]?.name).toBe('JSONInvalidSyntax')
  })
})

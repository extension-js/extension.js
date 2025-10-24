import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeEach, afterEach, expect, vi} from 'vitest'
import {LocalesPlugin} from '../index'
import * as getLocalesModule from '../get-locales'

// Minimal tapable-like hook helper
function createHook() {
  const taps: Array<() => void> = []
  return {
    tap: (_name: string | {name: string; stage?: number}, fn: () => void) => {
      taps.push(fn)
    },
    _runAll: () => {
      for (const fn of taps) fn()
    }
  }
}

const hasAnsi = (s: string) => /\u001b\[[0-9;]*m/.test(s)

describe('LocalesPlugin (unit)', () => {
  const tmpRoot = path.resolve(__dirname, '__tmp_locales_plugin__')
  const manifestPath = path.join(tmpRoot, 'manifest.json')
  const localesRoot = path.join(tmpRoot, '_locales')
  const enDir = path.join(localesRoot, 'en')
  const ptDir = path.join(localesRoot, 'pt_BR')

  beforeEach(() => {
    fs.mkdirSync(enDir, {recursive: true})
    fs.mkdirSync(ptDir, {recursive: true})
    fs.writeFileSync(manifestPath, '{"name":"x"}')
    fs.writeFileSync(
      path.join(enDir, 'messages.json'),
      '{"hello":{"message":"hi"}}'
    )
    fs.writeFileSync(
      path.join(ptDir, 'messages.json'),
      '{"hello":{"message":"oi"}}'
    )
    fs.writeFileSync(path.join(enDir, 'notes.txt'), 'note')
    fs.writeFileSync(path.join(enDir, 'logo.png'), '')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (fs.existsSync(tmpRoot))
      fs.rmSync(tmpRoot, {recursive: true, force: true})
  })

  function applyAndProcess(
    plugin: LocalesPlugin,
    overrides?: {mockGetLocales?: string[]}
  ) {
    const processAssetsHook = createHook()
    const thisCompilationHook = {
      tap: (_name: string, cb: (compilation: any) => void) => {
        cb(compilation)
      }
    }

    const compilation = {
      assets: {},
      errors: [] as any[],
      warnings: [] as any[],
      fileDependencies: new Set<string>(),
      hooks: {processAssets: processAssetsHook},
      emitAsset: (filename: string) => {
        ;(compilation as any)._emitted = (compilation as any)._emitted || []
        ;(compilation as any)._emitted.push(filename)
      }
    }

    const compiler = {
      options: {context: tmpRoot},
      hooks: {thisCompilation: thisCompilationHook}
    } as any

    if (overrides?.mockGetLocales) {
      vi.spyOn(getLocalesModule, 'getLocales').mockReturnValue(
        overrides.mockGetLocales
      )
    }

    plugin.apply(compiler)
    // run all registered processAssets hooks
    ;(processAssetsHook as any)._runAll()
    return compilation as any
  }

  it('emits only .json locale files and skips non-json', () => {
    const plugin = new LocalesPlugin({manifestPath})
    const compilation = applyAndProcess(plugin)

    const emitted: string[] = (compilation as any)._emitted || []
    expect(emitted.some((p) => p.endsWith('_locales/en/messages.json'))).toBe(
      true
    )
    expect(
      emitted.some((p) => p.endsWith('_locales/pt_BR/messages.json'))
    ).toBe(true)
    expect(emitted.some((p) => p.endsWith('_locales/en/notes.txt'))).toBe(false)
    expect(emitted.some((p) => p.endsWith('_locales/en/logo.png'))).toBe(false)
    // No warnings/errors for existing files
    expect(compilation.warnings.length).toBe(0)
    expect(compilation.errors.length).toBe(0)
  })

  it('does not emit when excluded by excludeList', () => {
    const excludedPath = path.join(enDir, 'messages.json')
    const plugin = new LocalesPlugin({
      manifestPath,
      excludeList: {any: excludedPath}
    } as any)
    const compilation = applyAndProcess(plugin)

    const emitted: string[] = (compilation as any)._emitted || []
    expect(emitted.some((p) => p.endsWith('_locales/en/messages.json'))).toBe(
      false
    )
    expect(
      emitted.some((p) => p.endsWith('_locales/pt_BR/messages.json'))
    ).toBe(true)
  })

  it('adds discovered .json files to fileDependencies', () => {
    const plugin = new LocalesPlugin({manifestPath})
    const compilation = applyAndProcess(plugin)

    const deps = Array.from(compilation.fileDependencies)
    expect(deps.some((p) => p.endsWith('_locales/en/messages.json'))).toBe(true)
    expect(deps.some((p) => p.endsWith('_locales/pt_BR/messages.json'))).toBe(
      true
    )
  })

  it('warns when a referenced file is missing (with metadata, no path in message)', () => {
    const missing = path.join(tmpRoot, '_locales', 'en', 'missing.json')
    const plugin = new LocalesPlugin({manifestPath})
    const compilation = applyAndProcess(plugin, {mockGetLocales: [missing]})

    expect(compilation.warnings.length).toBe(1)
    const warn: any = compilation.warnings[0]
    expect(warn.name).toBe('LocalesPluginMissingFile')
    expect(warn.file).toBe(missing)
    expect(typeof warn.message).toBe('string')
    expect(warn.message).not.toContain(missing)
    expect(hasAnsi(warn.message)).toBe(false)
    const emitted: string[] = (compilation as any)._emitted || []
    expect(emitted.length).toBe(0)
  })

  it('pushes an error and does not throw when manifest.json is missing (with metadata, no path in message)', () => {
    // create a clean temp root without a manifest.json
    const cleanRoot = path.resolve(__dirname, '__tmp_locales_plugin_missing__')
    if (fs.existsSync(cleanRoot))
      fs.rmSync(cleanRoot, {recursive: true, force: true})
    fs.mkdirSync(cleanRoot, {recursive: true})
    const missingManifestPath = path.join(cleanRoot, 'manifest.json')

    const processAssetsHook = createHook()
    const thisCompilationHook = {
      tap: (_name: string, cb: (compilation: any) => void) => cb(compilation)
    }
    const compilation: any = {
      assets: {},
      errors: [],
      warnings: [],
      fileDependencies: new Set<string>(),
      hooks: {processAssets: processAssetsHook},
      emitAsset: vi.fn()
    }
    const compiler: any = {
      options: {context: cleanRoot},
      hooks: {thisCompilation: thisCompilationHook}
    }

    const plugin = new LocalesPlugin({manifestPath: missingManifestPath})
    plugin.apply(compiler)
    ;(processAssetsHook as any)._runAll()

    expect(compilation.errors.length).toBe(1)
    const err: any = compilation.errors[0]
    expect(err.name).toBe('ManifestNotFoundError')
    expect(err.file).toBe(missingManifestPath)
    expect(typeof err.message).toBe('string')
    // Message format updated to a prefixed ERROR banner
    expect(err.message).toContain('ERROR manifest.json')
    expect(hasAnsi(err.message)).toBe(false)
    expect((compilation as any)._emitted).toBeUndefined()

    // cleanup
    if (fs.existsSync(cleanRoot))
      fs.rmSync(cleanRoot, {recursive: true, force: true})
  })
})

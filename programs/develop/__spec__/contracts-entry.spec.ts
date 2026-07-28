import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const developRoot = path.resolve(__dirname, '..')
const distChunkPath = path.join(developRoot, 'dist', 'contracts.mjs')
const packageJson = JSON.parse(
  fs.readFileSync(path.join(developRoot, 'package.json'), 'utf8')
)
const selfRequire = createRequire(path.join(developRoot, '__spec__', 'x.js'))

describe('the extension-develop/contracts entry', () => {
  it('is declared in exports with browser, default and types conditions', () => {
    const entry = packageJson.exports['./contracts']
    expect(entry).toBeDefined()
    expect(entry.browser).toBe('./dist/contracts.mjs')
    expect(entry.default).toBe('./dist/contracts.mjs')
    expect(entry.import).toBe('./dist/contracts.mjs')
    expect(entry.types).toBe('./dist/contracts-entry.d.ts')
  })

  it('resolves by specifier', () => {
    const resolved = selfRequire.resolve('extension-develop/contracts')
    expect([
      distChunkPath,
      path.join(developRoot, 'contracts-entry.ts')
    ]).toContain(resolved)
  })

  it('declares sideEffects: false', () => {
    expect(packageJson.sideEffects).toBe(false)
  })

  it('emits a chunk that imports nothing at all', () => {
    const chunk = fs.readFileSync(distChunkPath, 'utf8')
    expect(chunk).not.toMatch(/^\s*import\b/m)
    expect(chunk).not.toMatch(/\bfrom\s*["']/)
    expect(chunk).not.toContain('node:')
    expect(chunk).not.toMatch(/\brequire\s*\(/)
    expect(chunk).not.toMatch(/["']ws["']/)
  })

  it('exports the wire constants with the engine values', async () => {
    const mod = await import(distChunkPath)
    expect(mod.CONTROL_WS_PATH).toBe('/extjs-control')
    expect(mod.CONTROL_ENVELOPE_VERSION).toBe(1)
    expect(mod.LOG_EVENT_VERSION).toBe(1)
    expect(mod.CLOSE_BAD_INSTANCE).toBe(4001)
    expect(mod.CLOSE_BAD_HELLO).toBe(4002)
    expect(mod.CLOSE_CONTROL_UNAVAILABLE).toBe(4003)
    expect(mod.CLOSE_SLOW_CONSUMER).toBe(4008)
  })

  it('carries the frame types alongside the constants', () => {
    const entrySource = fs.readFileSync(
      path.join(developRoot, 'contracts-entry.ts'),
      'utf8'
    )
    expect(entrySource).toContain(
      "export * from './dev-server/control-bridge/contracts'"
    )
    expect(entrySource).toContain('LogQuery')

    const contractsSource = fs.readFileSync(
      path.join(developRoot, 'dev-server', 'control-bridge', 'contracts.ts'),
      'utf8'
    )
    for (const name of [
      'interface ResultFrame',
      'interface LogEvent',
      'interface ReadyFrame',
      'interface CommandFrame'
    ]) {
      expect(contractsSource).toContain(name)
    }
    expect(contractsSource).not.toMatch(/^\s*import\b/m)
  })

  it('ships types for the entry', () => {
    expect(
      fs.existsSync(path.join(developRoot, 'dist', 'contracts-entry.d.ts'))
    ).toBe(true)
  })

  it('leaves the bridge entry shape unchanged', () => {
    const bridge = packageJson.exports['./bridge']
    expect(bridge.development).toBe('./bridge-entry.ts')
    expect(bridge.types).toBe('./dist/bridge-entry.d.ts')
    expect(bridge.import).toBe('./dist/bridge.mjs')
  })
})

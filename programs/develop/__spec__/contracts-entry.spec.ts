import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import * as contracts from '../contracts-entry'

const developRoot = path.resolve(__dirname, '..')
const distChunkPath = path.join(developRoot, 'dist', 'contracts.mjs')
const packageJson = JSON.parse(
  fs.readFileSync(path.join(developRoot, 'package.json'), 'utf8')
)
const selfRequire = createRequire(path.join(developRoot, '__spec__', 'x.js'))

const NODE_ONLY = /^(node:|fs$|path$|os$|child_process$|crypto$)/

function importGraph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen

  seen.add(entry)

  const source = fs.readFileSync(entry, 'utf8')
  const specifiers = [
    ...source.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/^import\s+['"]([^'"]+)['"]/gm)
  ].map((match) => match[1])

  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) {
      seen.add(specifier)
      continue
    }

    const base = path.resolve(path.dirname(entry), specifier)
    const file = [`${base}.ts`, path.join(base, 'index.ts')].find((candidate) =>
      fs.existsSync(candidate)
    )

    if (file) importGraph(file, seen)
  }

  return seen
}

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

    expect(entrySource).toContain(
      "export * from './dev-server/control-bridge/log-rule'"
    )

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

  it('pulls in no Node-only module', () => {
    const graph = [
      ...importGraph(path.join(__dirname, '..', 'contracts-entry.ts'))
    ]
    const nodeOnly = graph.filter(
      (item) => !path.isAbsolute(item) && NODE_ONLY.test(item)
    )

    expect(nodeOnly).toEqual([])
  })

  it('publishes the log selection rule as values', () => {
    expect(contracts.LOG_LEVEL_ORDER).toEqual([
      'error',
      'warn',
      'info',
      'debug',
      'trace'
    ])

    expect(contracts.logLevelRank('log')).toBe(contracts.logLevelRank('info'))
    expect(
      contracts.matchesLogQuery(
        {context: 'background', level: 'debug'},
        {context: ' background , content ', level: 'info'}
      )
    ).toBe(false)

    expect(
      contracts.matchesLogQuery(
        {context: 'background', level: 'warn'},
        {context: ' background , content ', level: 'info'}
      )
    ).toBe(true)
  })
})

import {describe, expect, it} from 'vitest'
import classicTracedGlobalsLoader, {
  collectExposableClassicNames
} from '../steps/classic-traced-globals-loader'

describe('collectExposableClassicNames', () => {
  it('collects top-level function, var, let, const and class', () => {
    expect(
      collectExposableClassicNames(
        'var v = 1; let l = 2; const c = 3; function fn() {} class Cls {}'
      ).sort()
    ).toEqual(['Cls', 'c', 'fn', 'l', 'v'])
  })

  it('collects exported declarations and local re-exports, not imports', () => {
    expect(
      collectExposableClassicNames(
        [
          'import {sharedAdd} from "./shared";',
          'export function helper(n) { return sharedAdd(n) }',
          'export const label = "x";',
          'function localFn() {}',
          'export { localFn };'
        ].join('\n')
      ).sort()
    ).toEqual(['helper', 'label', 'localFn'])
  })

  it('does not expose a star-reexport or an export-from', () => {
    expect(
      collectExposableClassicNames(
        'export { sharedAdd } from "./shared";\nexport * from "./other";\n'
      )
    ).toEqual([])
  })
})

describe('classic-traced-globals-loader', () => {
  it('appends a globalThis bridge for each top-level name', () => {
    const source = [
      'import {sharedAdd} from "./shared";',
      'function workerShared(n) { return sharedAdd(n) }',
      ''
    ].join('\n')
    const output = classicTracedGlobalsLoader.call(
      {resourcePath: '/tmp/worker-shared.js'} as any,
      source
    )
    expect(output).toContain('function workerShared(n) { return sharedAdd(n) }')
    expect(output).toContain('globalThis["workerShared"] = workerShared')
    expect(output).not.toContain('globalThis["sharedAdd"]')
  })
})

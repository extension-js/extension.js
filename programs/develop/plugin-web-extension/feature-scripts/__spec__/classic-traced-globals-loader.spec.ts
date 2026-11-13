import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {
  closeCompletionValueBlock,
  INJECTED_CLASSIC_QUERY
} from '../scripts-lib/completion-value'
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

describe('a classic file executeScript injects from outside scripts/', () => {
  const loaded = (source: string, injected = true) =>
    String(
      classicTracedGlobalsLoader.call(
        {
          resourcePath: '/tmp/injected/tool.js',
          resourceQuery: injected
            ? `?__extensionjs_traced_classic__&${INJECTED_CLASSIC_QUERY}`
            : '?__extensionjs_traced_classic__'
        } as any,
        source
      )
    )

  const injectedInto = (text: string) => {
    const page: Record<string, unknown> = {}
    page.globalThis = page

    const {open, closed} = closeCompletionValueBlock(text)

    return {value: vm.runInNewContext(`${open}${closed}`, page), page}
  }

  it('ends on the value of its last statement, not on the last name it shares', () => {
    const source = 'const count = 20\ncount + 22\n'

    // As it shipped before: the file ended on the name the lines below set.
    expect(vm.runInNewContext(loaded(source, false), {})).toBe(20)

    const {value, page} = injectedInto(loaded(source))

    expect(value).toBe(42)
    expect(page.count).toBe(20)
  })

  it('ends on nothing when it only declares, a function included', () => {
    const source = 'const count = 20\nfunction helper() { return count }\n'

    // A function is a value the browser cannot clone, so the call rejected.
    expect(typeof vm.runInNewContext(loaded(source, false), {})).toBe(
      'function'
    )

    const {value, page} = injectedInto(loaded(source))

    expect(value).toBeUndefined()
    expect(typeof page.helper).toBe('function')
    expect(page.count).toBe(20)
  })

  it('leaves a file loaded any other way as it was', () => {
    const source = 'const count = 20\ncount + 22\n'

    expect(loaded(source, false)).not.toContain('__extjsCompletion')
    expect(loaded(source, false).startsWith(source)).toBe(true)
  })
})

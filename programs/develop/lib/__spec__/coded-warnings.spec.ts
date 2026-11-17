import {AsyncLocalStorage} from 'node:async_hooks'
import {describe, expect, it} from 'vitest'
import {
  outsideCodedWarnings,
  recordCodedWarning,
  takeCodedWarnings,
  withCodedWarnings
} from '../coded-warnings'
import {CODES} from '../messaging'

describe('coded warnings', () => {
  it('hands back each recorded line once, code first, and then nothing', () => {
    takeCodedWarnings()

    recordCodedWarning(CODES.E_TYPES_EMIT, 'the first thing')
    recordCodedWarning(CODES.E_TYPES_EMIT, 'the first thing')
    recordCodedWarning(CODES.E_POLYFILL_NOT_FOUND, 'the second thing')

    expect(takeCodedWarnings()).toEqual([
      'E_TYPES_EMIT: the first thing',
      'E_POLYFILL_NOT_FOUND: the second thing'
    ])

    expect(takeCodedWarnings()).toEqual([])
  })

  it('keeps two builds running at once from clearing each other', async () => {
    recordCodedWarning(CODES.E_TYPES_EMIT, 'left by an earlier run')

    let releaseFirst = () => {}

    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withCodedWarnings(async () => {
      recordCodedWarning(CODES.E_TYPES_EMIT, 'from the first build')
      await firstMayFinish

      return takeCodedWarnings()
    })

    // What a plugin hook of the first build records, outside its scope.
    recordCodedWarning(CODES.E_POLYFILL_NOT_FOUND, 'from a hook of the first')

    let releaseSecond = () => {}

    const secondMayFinish = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    // The second build starts while the first still runs.
    const second = withCodedWarnings(async () => {
      recordCodedWarning(CODES.E_PERF_BUDGET, 'from the second build')
      await secondMayFinish

      return takeCodedWarnings()
    })

    releaseFirst()

    expect(await first).toEqual([
      'E_TYPES_EMIT: from the first build',
      'E_POLYFILL_NOT_FOUND: from a hook of the first'
    ])

    releaseSecond()

    expect(await second).toEqual(['E_PERF_BUDGET: from the second build'])
    expect(takeCodedWarnings()).toEqual([])
  })

  it('runs the bundler start with no async scope open and hands back its value', async () => {
    const callerScope = new AsyncLocalStorage<string>()

    const seen = await callerScope.run('caller', () =>
      withCodedWarnings(async () => {
        await Promise.resolve()

        return {
          inside: callerScope.getStore(),
          outside: outsideCodedWarnings(() => callerScope.getStore())
        }
      })
    )

    expect(seen).toEqual({inside: 'caller', outside: undefined})
  })

  it('leaves what is recorded outside the scope for the build that asks', async () => {
    takeCodedWarnings()

    const taken = await withCodedWarnings(async () => {
      recordCodedWarning(CODES.E_TYPES_EMIT, 'from the build')
      outsideCodedWarnings(() =>
        recordCodedWarning(CODES.E_POLYFILL_NOT_FOUND, 'from the bundler')
      )

      return takeCodedWarnings()
    })

    expect(taken).toEqual([
      'E_TYPES_EMIT: from the build',
      'E_POLYFILL_NOT_FOUND: from the bundler'
    ])
  })
})

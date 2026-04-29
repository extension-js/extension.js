// Pins the bridge between programs/extension's banner.ts and develop's
// shared-state. Before the bridge, a compile that finished before the
// browser banner was printed would stay parked in `pendingCompilationLine`
// until the next `done` hook checked the env var — which made the initial
// run silent and double-printed on the first reload.

import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest'

const BANNER_PRINTED_EVENT = 'extensionjs:banner-printed'

async function freshSharedState() {
  vi.resetModules()
  return await import('../compilation-lib/shared-state')
}

describe('shared-state banner bridge', () => {
  const previousEnv = process.env.EXTENSION_CLI_BANNER_PRINTED
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    delete process.env.EXTENSION_CLI_BANNER_PRINTED
    process.removeAllListeners(BANNER_PRINTED_EVENT)
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    process.removeAllListeners(BANNER_PRINTED_EVENT)
    if (previousEnv === undefined)
      delete process.env.EXTENSION_CLI_BANNER_PRINTED
    else process.env.EXTENSION_CLI_BANNER_PRINTED = previousEnv
  })

  it('flushes the pending line synchronously when banner.ts emits', async () => {
    const {setPendingCompilationLine, isBannerPrinted, sharedState} =
      await freshSharedState()

    setPendingCompilationLine('  ⏵⏵⏵ deferred compile #1')
    expect(isBannerPrinted()).toBe(false)
    expect(logSpy).not.toHaveBeenCalled()

    ;(process as any).emit(BANNER_PRINTED_EVENT)

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('  ⏵⏵⏵ deferred compile #1')
    expect(sharedState.bannerPrinted).toBe(true)
    expect(sharedState.pendingCompilationLine).toBe('')
  })

  it('keeps the env var as a fallback when the event was missed', async () => {
    const {setPendingCompilationLine, isBannerPrinted} =
      await freshSharedState()

    setPendingCompilationLine('  ⏵⏵⏵ deferred compile #1')
    process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'

    expect(isBannerPrinted()).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('  ⏵⏵⏵ deferred compile #1')
  })

  it('does not double-print when both event and env var fire', async () => {
    const {setPendingCompilationLine, isBannerPrinted} =
      await freshSharedState()

    setPendingCompilationLine('  ⏵⏵⏵ deferred compile #1')
    ;(process as any).emit(BANNER_PRINTED_EVENT)
    process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'
    isBannerPrinted()

    expect(logSpy).toHaveBeenCalledTimes(1)
  })
})

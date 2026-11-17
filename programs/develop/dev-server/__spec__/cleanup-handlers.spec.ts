import {describe, expect, it, vi} from 'vitest'
import {setupCleanupHandlers} from '../cleanup'
import type {PortManager} from '../port-manager'

const LISTENED = [
  'uncaughtException',
  'unhandledRejection',
  'SIGINT',
  'SIGTERM',
  'SIGHUP'
] as const

function counts() {
  return LISTENED.map((event) => process.listenerCount(event))
}

function fakePortManager() {
  return {
    terminateCurrentInstance: vi.fn(async () => {})
  } as unknown as PortManager
}

describe('setupCleanupHandlers', () => {
  it('removes every process listener it added when disposed', () => {
    const before = counts()

    for (let session = 0; session < 3; session++) {
      const dispose = setupCleanupHandlers(
        () => null,
        fakePortManager(),
        undefined,
        {exit: () => {}, env: {}}
      )

      expect(counts()).toEqual(before.map((count) => count + 1))
      dispose()
    }

    expect(counts()).toEqual(before)
  })
})

import {describe, expect, it} from 'vitest'
import {
  __activeFirefoxInstanceCount,
  setupFirefoxProcessHandlers
} from '../../run-firefox/firefox-launch/process-handlers'

const noChild = () => null
const noCleanup = async () => {}

describe('setupFirefoxProcessHandlers lifecycle', () => {
  const events = [
    'SIGINT',
    'SIGTERM',
    'SIGHUP',
    'exit',
    'beforeExit',
    'uncaughtException',
    'unhandledRejection'
  ] as const

  it('installs global process listeners only once across multiple instances', () => {
    const before = events.map((e) => process.listenerCount(e))
    const d1 = setupFirefoxProcessHandlers('firefox', noChild, noCleanup)
    const after1 = events.map((e) => process.listenerCount(e))
    const d2 = setupFirefoxProcessHandlers('firefox', noChild, noCleanup)
    const after2 = events.map((e) => process.listenerCount(e))

    events.forEach((_event, i) => {
      expect(after2[i]).toBe(after1[i])
      expect(after1[i]).toBeLessThanOrEqual(before[i] + 1)
    })

    d1()
    d2()
  })

  it('registers and unregisters instances via the returned disposer', () => {
    const base = __activeFirefoxInstanceCount()

    const d1 = setupFirefoxProcessHandlers('firefox', noChild, noCleanup)
    expect(__activeFirefoxInstanceCount()).toBe(base + 1)

    const d2 = setupFirefoxProcessHandlers('firefox', noChild, noCleanup)
    expect(__activeFirefoxInstanceCount()).toBe(base + 2)

    d1()
    expect(__activeFirefoxInstanceCount()).toBe(base + 1)

    d2()
    expect(__activeFirefoxInstanceCount()).toBe(base)
  })
})

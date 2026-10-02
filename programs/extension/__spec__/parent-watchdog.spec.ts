import {describe, expect, it} from 'vitest'
import {parseParentPid, setupParentWatchdog} from '../helpers/parent-watchdog'

const DEAD_PID = 999999999

describe('the parent watchdog', () => {
  it('frames the refusal before the shutdown begins', () => {
    const order: string[] = []

    setupParentWatchdog(DEAD_PID, {
      log: () => order.push('log'),
      emitFrame: () => order.push('frame'),
      onDeath: () => order.push('shutdown')
    })

    expect(order).toEqual(['log', 'frame', 'shutdown'])
  })

  it('reports nothing while the parent is alive', () => {
    const order: string[] = []
    const cancel = setupParentWatchdog(process.pid, {
      log: () => order.push('log'),
      emitFrame: () => order.push('frame'),
      onDeath: () => order.push('shutdown'),
      pollIntervalMs: 10
    })

    expect(order).toEqual([])
    cancel()
  })

  it('reads a pid only from a positive integer', () => {
    expect(parseParentPid('4242')).toBe(4242)
    expect(parseParentPid('zero')).toBeUndefined()
    expect(parseParentPid('-1')).toBeUndefined()
  })
})

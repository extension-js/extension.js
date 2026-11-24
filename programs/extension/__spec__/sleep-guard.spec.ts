import {describe, expect, it} from 'vitest'
import {lastSleepWindow, sleptDuring} from './setup/sleep-guard'

const kernel = (values: Record<string, number | undefined>) => (name: string) =>
  values[name]

describe('the system sleep note on a failed row', () => {
  it('names the sleep when the system woke after the row started', () => {
    const window = lastSleepWindow(
      'darwin',
      kernel({'kern.sleeptime': 10_000, 'kern.waketime': 1_060_000})
    )
    const note = sleptDuring(5_000, window)

    expect(note).toContain('macOS slept for 1050 s')
    expect(note).toContain('caffeinate -s')
  })

  it('says nothing when the last wake came before the row', () => {
    const window = lastSleepWindow(
      'darwin',
      kernel({'kern.sleeptime': 10_000, 'kern.waketime': 20_000})
    )

    expect(sleptDuring(30_000, window)).toBeUndefined()
  })

  it('reads no window off macOS or when the kernel gives none', () => {
    const read = kernel({'kern.sleeptime': 1, 'kern.waketime': 2})

    expect(lastSleepWindow('linux', read)).toBeUndefined()
    expect(lastSleepWindow('darwin', kernel({}))).toBeUndefined()
  })

  it('reads this machine without throwing', () => {
    const window = lastSleepWindow()

    if (process.platform === 'darwin' && window) {
      expect(window.wokeAt).toBeGreaterThanOrEqual(window.sleptAt)
    } else {
      expect(window).toBeUndefined()
    }
  })
})

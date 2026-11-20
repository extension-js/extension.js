import * as os from 'node:os'
import {describe, expect, it, vi} from 'vitest'
import {takeMissingMockExports} from './setup/mock-export-guard'

vi.mock('node:os', () => ({platform: () => 'stand-in'}))

// What code under test does with a mock that lacks an export: it catches the
// throw and carries on as if the disk had failed.
function swallowed(read: () => unknown): string {
  try {
    return String(read())
  } catch {
    return 'failure branch'
  }
}

describe('the mock export guard', () => {
  it('sees an export a mock leaves out, even when the code swallows the throw', () => {
    expect(swallowed(() => os.platform())).toBe('stand-in')
    expect(takeMissingMockExports()).toEqual([])

    expect(swallowed(() => os.homedir())).toBe('failure branch')

    const seen = takeMissingMockExports()

    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain(
      'No "homedir" export is defined on the "node:os" mock'
    )
  })

  it('forgets what it handed over, so the next spec starts clean', () => {
    expect(takeMissingMockExports()).toEqual([])
  })
})

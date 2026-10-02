import {describe, expect, it} from 'vitest'
import {browserExitedUnasked} from '../browsers-lib/messages'

describe('browserExitedUnasked', () => {
  it('names an outside quit on a clean exit and ends the preview', () => {
    const line = browserExitedUnasked('edge', 0, null, 'preview')

    expect(line).toContain(
      '[browser] edge closed cleanly (exit code 0) without this preview asking for it'
    )

    expect(line).toContain(
      'the window was closed, or another process told it to quit'
    )

    expect(line).toMatch(/The preview session is over\.$/)
    expect(line).not.toContain('crash')
  })

  it('names the signal when the browser was killed', () => {
    const line = browserExitedUnasked('chrome', null, 'SIGKILL', 'preview')

    expect(line).toContain('[browser] chrome was killed by signal SIGKILL')
    expect(line).toMatch(/The preview session is over\.$/)
  })

  it('names a crash on a non-zero exit code', () => {
    const line = browserExitedUnasked('edge', 1, null, 'preview')

    expect(line).toContain('[browser] edge crashed (exit code 1)')
    expect(line).not.toContain('another process')
  })

  it('keeps the restart advice for a dev session', () => {
    const line = browserExitedUnasked('edge', 0, null, 'dev')

    expect(line).toContain('without this dev session asking for it')
    expect(line).toContain('The dev server is still running')
    expect(line).toContain('restart "extension dev"')
    expect(line).not.toContain('preview')
  })

  it('names start when start ran the session', () => {
    const line = browserExitedUnasked('chromium', 0, null, 'start')

    expect(line).toContain('without this start session asking for it')
    expect(line).toMatch(/The start session is over\.$/)
    expect(line).not.toContain('preview')
  })
})

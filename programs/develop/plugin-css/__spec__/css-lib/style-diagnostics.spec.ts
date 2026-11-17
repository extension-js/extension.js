import {describe, expect, it, vi} from 'vitest'
import {
  beginStyleDiagnostics,
  reportStyleDiagnostic
} from '../../css-lib/style-diagnostics'

describe('style diagnostics', () => {
  it('prints a finding once per compiler, however many rules find it', () => {
    const print = vi.fn()
    beginStyleDiagnostics('/project/once', 'production')

    for (let rule = 0; rule < 24; rule++) {
      reportStyleDiagnostic('/project/once', 'plugin a is missing', print)
    }

    reportStyleDiagnostic('/project/once', 'plugin b is missing', print)

    expect(print.mock.calls).toEqual([
      ['plugin a is missing'],
      ['plugin b is missing']
    ])
  })

  it('prints it again in the next build', () => {
    const print = vi.fn()

    beginStyleDiagnostics('/project/builds', 'production')
    reportStyleDiagnostic('/project/builds', 'plugin a is missing', print)
    beginStyleDiagnostics('/project/builds', 'production')
    reportStyleDiagnostic('/project/builds', 'plugin a is missing', print)

    expect(print).toHaveBeenCalledTimes(2)
  })

  it('stays quiet in a dev session whose next compiler finds the same', () => {
    const print = vi.fn()

    beginStyleDiagnostics('/project/dev', 'development')
    reportStyleDiagnostic('/project/dev', 'plugin a is missing', print)
    beginStyleDiagnostics('/project/dev', 'development')
    reportStyleDiagnostic('/project/dev', 'plugin a is missing', print)
    reportStyleDiagnostic('/project/dev', 'plugin b is missing', print)

    expect(print.mock.calls).toEqual([
      ['plugin a is missing'],
      ['plugin b is missing']
    ])
  })

  it('says a finding again in dev once it went away and came back', () => {
    const print = vi.fn()

    beginStyleDiagnostics('/project/back', 'development')
    reportStyleDiagnostic('/project/back', 'plugin a is missing', print)
    beginStyleDiagnostics('/project/back', 'development')
    beginStyleDiagnostics('/project/back', 'development')
    reportStyleDiagnostic('/project/back', 'plugin a is missing', print)

    expect(print).toHaveBeenCalledTimes(2)
  })

  it('keeps one project from quieting another', () => {
    const print = vi.fn()

    beginStyleDiagnostics('/project/one', 'production')
    beginStyleDiagnostics('/project/two', 'production')
    reportStyleDiagnostic('/project/one', 'plugin a is missing', print)
    reportStyleDiagnostic('/project/two', 'plugin a is missing', print)

    expect(print).toHaveBeenCalledTimes(2)
  })

  it('prints every finding for a caller no compiler opened a round for', () => {
    const print = vi.fn()

    reportStyleDiagnostic('/project/none', 'plugin a is missing', print)
    reportStyleDiagnostic('/project/none', 'plugin a is missing', print)

    expect(print).toHaveBeenCalledTimes(2)
  })
})

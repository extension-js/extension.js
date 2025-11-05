import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {tmpdir} from 'os'
import {
  isFirstRun,
  shouldShowFirstRun,
  markFirstRunMessageShown,
  hasShownFirstRunMessage
} from '../webpack/webpack-lib/first-run'

describe('first run helpers', () => {
  it('isFirstRun returns true when profile folder missing', () => {
    const out = path.join(tmpdir(), `extjs-test-${Date.now()}`)
    expect(isFirstRun(path.join(out, 'dist/chrome'), 'chrome')).toBe(true)
  })

  it('shouldShowFirstRun true then false after marking', () => {
    const out = path.join(tmpdir(), `extjs-test-${Date.now()}`)
    const project = out
    expect(
      shouldShowFirstRun(path.join(out, 'dist/chrome'), 'chrome', project)
    ).toBe(true)
    markFirstRunMessageShown(project, 'chrome')
    expect(hasShownFirstRunMessage(project, 'chrome')).toBe(true)
  })
})

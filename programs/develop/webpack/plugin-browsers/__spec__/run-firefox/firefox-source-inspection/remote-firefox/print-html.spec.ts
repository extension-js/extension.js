import {describe, it, expect, vi, beforeEach} from 'vitest'
import {SetupFirefoxInspectionStep as Step} from '../../../../../run-firefox/firefox-source-inspection'

describe('SetupFirefoxInspectionStep printHTML', () => {
  let logSpy: any
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('calls printHTML safely', async () => {
    const step: any = new Step({browser: 'firefox', port: 6000})
    expect(() => step['printHTML']('ok')).not.toThrow()
    logSpy.mockRestore()
  })
})

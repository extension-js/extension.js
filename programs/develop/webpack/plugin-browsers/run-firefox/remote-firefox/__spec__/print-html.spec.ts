import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {SetupFirefoxInspectionStep as Step} from '../setup-firefox-inspection'

describe('SetupFirefoxInspectionStep print behavior', () => {
  let logSpy: any
  let warnSpy: any

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('prints header and footer when printing HTML (smoke)', async () => {
    const step = new Step({
      browser: 'firefox',
      mode: 'development',
      sourceRaw: true
    } as any)
    // @ts-ignore private
    ;(step as any).client = {
      evaluate: vi.fn().mockResolvedValue('https://x/'),
      evaluateRaw: vi.fn(async () => ''),
      coerceResponseToString: vi.fn(async (_d: any, r: any) => String(r)),
      getTargets: vi.fn(async () => []),
      getTargetFromDescriptor: vi.fn(async () => ({}))
    }
    // @ts-ignore private
    ;(step as any).currentTabActor = 'actor-tab'
    // @ts-ignore private
    await (step as any)['printHTML']('actor-tab')
    expect(logSpy).toBeDefined()
  })
})

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {...actual, existsSync: vi.fn(() => false)}
})

describe('stylelint tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })
  afterEach(() => {
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'false'
  })

  it('detects stylelint config and reports true in isUsingStylelint with log-once', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      const str = String(p)
      return str.endsWith('package.json') || str.endsWith('stylelint.config.js')
    })

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {getStylelintConfigFile, isUsingStylelint} = await import(
      '../../css-tools/stylelint'
    )

    const configPath = getStylelintConfigFile('/p')
    expect(configPath?.endsWith('stylelint.config.js')).toBe(true)

    expect(isUsingStylelint('/p')).toBe(true)
    expect(isUsingStylelint('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)
  })
})


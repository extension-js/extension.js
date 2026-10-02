import {describe, expect, it} from 'vitest'
import {chromeInitializingEnhancedReload} from '../browsers-lib/messages'

describe('chromeInitializingEnhancedReload', () => {
  it('names the browser the session launched on a non-chrome target', () => {
    const line = chromeInitializingEnhancedReload('yandex')

    expect(line).toContain('enhancedReload=init')
    expect(line).toContain('spawn=direct')
    expect(line).toContain('browser=yandex')
    expect(line).not.toContain('browser=chrome ')
    expect(line).not.toMatch(/browser=chrome$/)
  })

  it('still names chrome on a chrome target', () => {
    expect(chromeInitializingEnhancedReload('chrome')).toContain(
      'browser=chrome'
    )
  })

  it('names every supported target it is given', () => {
    const targets = ['edge', 'brave', 'opera', 'vivaldi', 'firefox'] as const

    for (const target of targets) {
      expect(chromeInitializingEnhancedReload(target)).toContain(
        `browser=${target}`
      )
    }
  })
})

import {describe, expect, it} from 'vitest'
import {buildComplete} from '../messages'

describe('buildComplete', () => {
  it('says production for a production build', () => {
    const out = buildComplete('chrome', 'dist/chrome', 1024, 'production')
    expect(out).toContain('built for production in')
    expect(out).toContain('dist/chrome')
  })

  it('says development for a development build', () => {
    const out = buildComplete('chrome', 'dist/chrome', 1024, 'development')
    expect(out).toContain('built for development in')
    expect(out).not.toContain('built for production')
  })

  it('names no mode at all for a none build', () => {
    const out = buildComplete('chrome', 'dist/chrome', 1024, 'none')
    expect(out).toContain('built in')
    expect(out).not.toContain('for production')
    expect(out).not.toContain('for development')
  })

  // Every caller that predates the mode argument keeps its wording, which is
  // what the existing production assertions across the build specs rely on.
  it('still says production when no mode is passed', () => {
    expect(buildComplete('chrome', 'dist/chrome', 1024)).toContain(
      'built for production in'
    )
  })

  it('keeps the size suffix and drops it when there is nothing to report', () => {
    expect(buildComplete('edge', 'dist/edge', 2048, 'development')).toMatch(
      /\(2\.0 KB\)/
    )

    expect(buildComplete('edge', 'dist/edge', 0, 'development')).not.toContain(
      '('
    )
  })
})

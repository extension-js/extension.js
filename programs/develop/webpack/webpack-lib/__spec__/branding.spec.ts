import {describe, it, expect, vi} from 'vitest'
import {scrubBrand, makeSanitizedConsole} from '../../webpack-lib/branding'

describe('webpack-lib/branding', () => {
  it('scrubBrand replaces tool brands and normalizes errors/newlines', () => {
    const input = [
      'Rspack something',
      'Webpack something',
      'ModuleBuildError: detail',
      'ModuleParseError: detail',
      'Error: Module build failed: blah',
      '',
      '',
      ''
    ].join('\n')
    const out = scrubBrand(input, 'Extension.js')
    expect(out).toContain('Extension.js something')
    expect(out).not.toContain('ModuleBuildError:')
    expect(out).not.toContain('ModuleParseError:')
    expect(out).not.toContain('Module build failed')
    // collapses multiple newlines
    expect(out).not.toMatch(/\n{3,}/)
  })

  it('makeSanitizedConsole sanitizes string arguments', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const sanitized = makeSanitizedConsole('Extension.js')
    sanitized.log('Rspack error', {keep: true})
    expect(logSpy).toHaveBeenCalledWith('Extension.js error', {keep: true})
    logSpy.mockRestore()
  })
})

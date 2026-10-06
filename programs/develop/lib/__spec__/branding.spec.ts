import {afterEach, describe, expect, it, vi} from 'vitest'
import {makeSanitizedConsole, scrubBrand} from '../../lib/branding'

describe('webpack-lib/branding', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('scrubBrand replaces tool brands and normalizes errors/newlines', () => {
    const input = [
      'Rspack something',
      'Webpack something',
      '@rspack/plugin-react-refresh',
      '@webpack/cli',
      'ModuleBuildError: detail',
      'ModuleParseError: detail',
      'Error: Module build failed: blah',
      '',
      '',
      ''
    ].join('\n')
    const out = scrubBrand(input, 'Extension.js')
    expect(out).toContain('Extension.js something')
    expect(out).toContain('@rspack/plugin-react-refresh')
    expect(out).toContain('@webpack/cli')
    expect(out).not.toContain('ModuleBuildError:')
    expect(out).not.toContain('ModuleParseError:')
    expect(out).not.toContain('Module build failed')
    expect(out).not.toMatch(/\n{3,}/)
  })

  it('makeSanitizedConsole sanitizes string arguments', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const sanitized = makeSanitizedConsole('Extension.js')
    sanitized.log('Rspack error', {keep: true})
    expect(logSpy).toHaveBeenCalledWith('Extension.js error', {keep: true})
    logSpy.mockRestore()
  })

  it('makeSanitizedConsole writes log and info to stderr under machine output', () => {
    vi.stubEnv('EXTENSION_OUTPUT', 'json')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)

    const sanitized = makeSanitizedConsole('Extension.js')
    sanitized.log('Rspack infrastructure line')
    sanitized.info('Webpack info line')

    expect(logSpy).not.toHaveBeenCalled()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith('Extension.js infrastructure line\n')
    expect(stderr).toHaveBeenCalledWith('Extension.js info line\n')
  })

  it('preserves rspack optimization warnings and docs links', () => {
    const input = [
      'WARNING in ⚠ Rspack performance recommendations:',
      '  │ You can limit the size of your bundles by using import() to lazy load some parts of your application.',
      '  │ For more info visit https://rspack.rs/guide/optimization/code-splitting'
    ].join('\n')

    const out = scrubBrand(input, 'Extension.js')

    expect(out).toContain('WARNING in ⚠ Rspack performance recommendations:')
    expect(out).toContain('https://rspack.rs/guide/optimization/code-splitting')
    expect(out).not.toContain('Extension.js performance recommendations')
    expect(out).not.toContain('https://Extension.js.rs/')
  })
})

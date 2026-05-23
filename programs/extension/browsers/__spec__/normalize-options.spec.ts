import {describe, expect, it} from 'vitest'
import * as os from 'os'
import * as path from 'path'
import {normalizePluginOptions} from '../browsers-lib/normalize-options'

// normalizePluginOptions reads many PluginInterface fields; tests pass a minimal
// object cast to the expected shape.
const normalize = (options: Record<string, unknown>) =>
  normalizePluginOptions(options as any)

describe('normalizePluginOptions binary path normalization', () => {
  it('strips surrounding double quotes from chromiumBinary', () => {
    expect(normalize({chromiumBinary: '"/Apps/Chrome"'}).chromiumBinary).toBe(
      '/Apps/Chrome'
    )
  })

  it('strips surrounding single quotes from geckoBinary', () => {
    expect(normalize({geckoBinary: "'/Apps/Firefox'"}).geckoBinary).toBe(
      '/Apps/Firefox'
    )
  })

  it('trims whitespace then strips quotes', () => {
    expect(
      normalize({chromiumBinary: '  "/Apps/Chrome"  '}).chromiumBinary
    ).toBe('/Apps/Chrome')
  })

  it('expands a leading ~ to the home directory', () => {
    expect(normalize({chromiumBinary: '~/bin/chrome'}).chromiumBinary).toBe(
      path.join(os.homedir(), '/bin/chrome')
    )
  })

  it('strips quotes AND expands ~ together', () => {
    expect(normalize({geckoBinary: '"~/bin/firefox"'}).geckoBinary).toBe(
      path.join(os.homedir(), '/bin/firefox')
    )
  })

  it('leaves a plain absolute path unchanged', () => {
    expect(
      normalize({chromiumBinary: '/usr/bin/chromium'}).chromiumBinary
    ).toBe('/usr/bin/chromium')
  })
})

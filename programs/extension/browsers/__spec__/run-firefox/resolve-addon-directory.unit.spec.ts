import {describe, expect, it} from 'vitest'
import {resolveAddonDirectory} from '../../run-firefox/rdp/remote-firefox/addons'

describe('resolveAddonDirectory quote handling', () => {
  it('strips surrounding double quotes', () => {
    expect(resolveAddonDirectory('/base', '"/abs/addon-dir"')).toBe(
      '/abs/addon-dir'
    )
  })

  it('strips surrounding single quotes', () => {
    expect(resolveAddonDirectory('/base', "'/abs/addon-dir'")).toBe(
      '/abs/addon-dir'
    )
  })

  it('does NOT strip quotes that are not surrounding (previous bug removed all)', () => {
    expect(resolveAddonDirectory('/base', '/abs/we"ird')).toBe('/abs/we"ird')
  })

  it('leaves a plain absolute path unchanged', () => {
    expect(resolveAddonDirectory('/base', '/abs/addon-dir')).toBe(
      '/abs/addon-dir'
    )
  })
})

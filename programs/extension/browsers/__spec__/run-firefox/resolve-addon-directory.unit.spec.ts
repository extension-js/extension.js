import {describe, expect, it} from 'vitest'
import {resolveAddonDirectory} from '../../run-firefox/rdp/remote-firefox/addons'

// These absolute paths don't exist on disk, so resolveAddonDirectory falls
// through to returning the (quote-stripped) candidate, which is exactly the
// behavior under test.
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
    // A non-surrounding double quote must be preserved, not stripped.
    expect(resolveAddonDirectory('/base', '/abs/we"ird')).toBe('/abs/we"ird')
  })

  it('leaves a plain absolute path unchanged', () => {
    expect(resolveAddonDirectory('/base', '/abs/addon-dir')).toBe(
      '/abs/addon-dir'
    )
  })
})

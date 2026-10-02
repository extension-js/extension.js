import {describe, expect, it} from 'vitest'
import {zipFilenameForVendor} from '../commands/build'

describe('zipFilenameForVendor', () => {
  // Every browser wrote to the same explicit path, so a release job uploaded
  // one browser's package believing it had both.
  it('inserts the vendor when more than one browser is built', () => {
    expect(zipFilenameForVendor('store-upload.zip', 'firefox', 2)).toBe(
      'store-upload-firefox.zip'
    )

    expect(zipFilenameForVendor('store-upload.zip', 'chrome', 2)).toBe(
      'store-upload-chrome.zip'
    )
  })

  it('keeps the name exactly as typed for a single browser', () => {
    expect(zipFilenameForVendor('store-upload.zip', 'chrome', 1)).toBe(
      'store-upload.zip'
    )
  })

  it('adds the extension when the typed name has none', () => {
    expect(zipFilenameForVendor('store-upload', 'edge', 3)).toBe(
      'store-upload-edge.zip'
    )
  })

  it('leaves an absent filename absent, so the default naming applies', () => {
    expect(zipFilenameForVendor(undefined, 'chrome', 3)).toBeUndefined()
  })

  it('matches the extension case-insensitively', () => {
    expect(zipFilenameForVendor('Release.ZIP', 'chrome', 2)).toBe(
      'Release-chrome.zip'
    )
  })
})

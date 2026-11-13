import {describe, expect, it} from 'vitest'
import {
  extensionBaseFromManifestUrl,
  pickExtensionBaseUrl,
  pickMozExtensionHost,
  readExtensionBaseUrl
} from '../run-firefox/rdp/remote-firefox/moz-id'

describe('pickMozExtensionHost', () => {
  it('returns the host when exactly one moz-extension target is present', () => {
    expect(
      pickMozExtensionHost([
        'moz-extension://11111111-1111-1111-1111-111111111111/manifest.json'
      ])
    ).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('refuses to guess when two distinct moz-extension hosts are present', () => {
    expect(
      pickMozExtensionHost([
        'moz-extension://11111111-1111-1111-1111-111111111111/manifest.json',
        'moz-extension://22222222-2222-2222-2222-222222222222/popup.html'
      ])
    ).toBeUndefined()
  })

  it('collapses repeated targets of the same host to a single candidate', () => {
    expect(
      pickMozExtensionHost([
        'moz-extension://11111111-1111-1111-1111-111111111111/manifest.json',
        'moz-extension://11111111-1111-1111-1111-111111111111/background.js'
      ])
    ).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('returns undefined when there are no moz-extension targets', () => {
    expect(
      pickMozExtensionHost(['about:blank', 'https://example.com/', undefined])
    ).toBeUndefined()
  })

  it('ignores malformed urls and returns the single valid host', () => {
    expect(
      pickMozExtensionHost([
        'moz-extension://',
        'not a url',
        undefined,
        'moz-extension://33333333-3333-3333-3333-333333333333/index.html'
      ])
    ).toBe('33333333-3333-3333-3333-333333333333')
  })
})

describe('the address Firefox serves an add-on from', () => {
  const ADDONS = [
    {
      id: 'formautofill@mozilla.org',
      manifestURL:
        'moz-extension://c2f47412-af15-43f5-858b-87535bcdc201/manifest.json'
    },
    {
      id: '2a386088b31a1fdc9007d7f81d30ddb92a32c574@temporary-addon',
      manifestURL:
        'moz-extension://305a8e3f-2f12-4c62-8198-89ee682bd857/manifest.json'
    }
  ]

  it('reads the base off the manifest url and nothing else', () => {
    expect(
      extensionBaseFromManifestUrl(
        'moz-extension://305a8e3f-2f12-4c62-8198-89ee682bd857/manifest.json'
      )
    ).toBe('moz-extension://305a8e3f-2f12-4c62-8198-89ee682bd857/')

    expect(
      extensionBaseFromManifestUrl('file:///tmp/dist/firefox/manifest.json')
    ).toBeUndefined()

    expect(
      extensionBaseFromManifestUrl('moz-extension://host/pages/demo.html')
    ).toBeUndefined()

    expect(extensionBaseFromManifestUrl(undefined)).toBeUndefined()
  })

  it('picks the add-on by the id the install answered', () => {
    expect(
      pickExtensionBaseUrl(
        ADDONS,
        '2a386088b31a1fdc9007d7f81d30ddb92a32c574@temporary-addon'
      )
    ).toBe('moz-extension://305a8e3f-2f12-4c62-8198-89ee682bd857/')
  })

  it('picks the add-on by its host when the id was derived from a target', () => {
    expect(
      pickExtensionBaseUrl(ADDONS, '305a8e3f-2f12-4c62-8198-89ee682bd857')
    ).toBe('moz-extension://305a8e3f-2f12-4c62-8198-89ee682bd857/')
  })

  it('answers nothing for an add-on Firefox does not list', () => {
    expect(pickExtensionBaseUrl(ADDONS, 'other@example.com')).toBeUndefined()
    expect(pickExtensionBaseUrl([], 'other@example.com')).toBeUndefined()
  })

  it('asks the root actor once and survives a wire that fails', async () => {
    const requests: unknown[] = []

    expect(
      await readExtensionBaseUrl(
        {
          request: async (payload) => {
            requests.push(payload)

            return {addons: ADDONS}
          }
        },
        '2a386088b31a1fdc9007d7f81d30ddb92a32c574@temporary-addon'
      )
    ).toBe('moz-extension://305a8e3f-2f12-4c62-8198-89ee682bd857/')

    expect(requests).toEqual([{to: 'root', type: 'listAddons'}])

    expect(
      await readExtensionBaseUrl(
        {
          request: async () => {
            throw new Error('connection closed')
          }
        },
        'x@example.com'
      )
    ).toBeUndefined()

    expect(
      await readExtensionBaseUrl({request: async () => ({})}, undefined)
    ).toBeUndefined()
  })
})

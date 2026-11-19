import {describe, expect, it} from 'vitest'
import {companionLinkNotAStoreLink} from '../../lib/messages'
import {
  isCompanionStoreLink,
  isCompanionWebLink
} from '../folder-extensions/resolve-config'

const ID = 'fmkadmapgofadopljbjfkapdkoienihi'

describe('whether a companion entry is a store link', () => {
  it.each([
    `https://chromewebstore.google.com/detail/react-developer-tools/${ID}`,
    `https://chromewebstore.google.com/detail/${ID}`,
    `https://chromewebstore.google.com/detail/react-developer-tools/${ID}?hl=en`,
    `https://chromewebstore.google.com/detail/react-developer-tools/${ID}/reviews`,
    `https://chromewebstore.google.com/detail/react-developer-tools/${ID}#top`,
    `https://www.chromewebstore.google.com/detail/name/${ID}`,
    `https://chrome.google.com/webstore/detail/name/${ID}`,
    `http://chromewebstore.google.com/detail/name/${ID}`,
    `chromewebstore.google.com/detail/name/${ID}`,
    `https://CHROMEWEBSTORE.google.com/detail/name/${ID.toUpperCase()}`,
    `https://microsoftedge.microsoft.com/addons/detail/name/${ID}`,
    `https://microsoftedge.microsoft.com/addons/detail/name/${ID}?hl=en-US`,
    `microsoftedge.microsoft.com/addons/detail/name/${ID}`,
    'https://addons.mozilla.org/en-US/firefox/addon/react-devtools/',
    'https://addons.mozilla.org/en-US/firefox/addon/react-devtools',
    'https://addons.mozilla.org/firefox/addon/react-devtools/reviews/?page=2',
    'http://addons.mozilla.org/en-US/firefox/addon/react-devtools/',
    'addons.mozilla.org/en-US/firefox/addon/react-devtools/'
  ])('yes: %s', (entry) => {
    expect(isCompanionWebLink(entry)).toBe(true)
    expect(isCompanionStoreLink(entry)).toBe(true)
  })

  // A web link all the same, so it is refused and never read as a folder.
  it.each([
    'https://example.com/x.zip',
    'http://example.com/x.zip',
    `https://example.com/detail/name/${ID}`,
    'https://chromewebstore.google.com/',
    'https://chromewebstore.google.com/detail/name/too-short',
    `https://chrome.google.com/detail/name/${ID}`,
    'https://microsoftedge.microsoft.com/addons/Microsoft-Edge-Extensions-Home',
    'https://addons.mozilla.org/en-US/firefox/',
    'chromewebstore.google.com'
  ])('no, a web link that is no store link: %s', (entry) => {
    expect(isCompanionWebLink(entry)).toBe(true)
    expect(isCompanionStoreLink(entry)).toBe(false)
  })

  it.each([
    'my-ext',
    './tools/my-ext',
    '/abs/my-ext',
    ID,
    'example.com/x.zip',
    `ftp://chromewebstore.google.com/detail/name/${ID}`,
    `file:///detail/name/${ID}`,
    ''
  ])('no, and no web link either: %s', (entry) => {
    expect(isCompanionWebLink(entry)).toBe(false)
    expect(isCompanionStoreLink(entry)).toBe(false)
  })

  it('builds the refusal a web link that is no store link gets', () => {
    expect(companionLinkNotAStoreLink('https://example.com/x.zip')).toBe(
      'Companion extension link is not a store link this resolver recognizes: https://example.com/x.zip\n' +
        'Supported links: https://chromewebstore.google.com/detail/<name>/<id>, ' +
        'https://microsoftedge.microsoft.com/addons/detail/<name>/<id>, ' +
        'https://addons.mozilla.org/<locale>/firefox/addon/<slug>'
    )
  })
})

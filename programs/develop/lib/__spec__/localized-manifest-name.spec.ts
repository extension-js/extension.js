import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {resolveLocalizedManifestName} from '../localized-manifest-name'

function writeMessages(root: string, locale: string, name: string) {
  const dir = path.join(root, '_locales', locale)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'messages.json'),
    JSON.stringify({extName: {message: name}})
  )
}

// The name the terminal prints is the one the browser shows: the manifest's
// default_locale value, else the reader's language, never the __MSG_ key when
// a messages file can answer it.
describe('resolveLocalizedManifestName', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-name-'))
    writeMessages(root, 'en', 'Lance')
    writeMessages(root, 'pt_BR', 'Lanca BR')
    writeMessages(root, 'pt', 'Lanca')
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('reads the default_locale value for a __MSG_ name', () => {
    expect(
      resolveLocalizedManifestName(
        {name: '__MSG_extName__', default_locale: 'en'},
        [root],
        {systemLocale: 'de-DE'}
      )
    ).toBe('Lance')
  })

  it('falls back to the reader language, spelled the way Chrome names folders', () => {
    expect(
      resolveLocalizedManifestName({name: '__MSG_extName__'}, [root], {
        systemLocale: 'pt-BR'
      })
    ).toBe('Lanca BR')

    expect(
      resolveLocalizedManifestName({name: '__MSG_extName__'}, [root], {
        systemLocale: 'pt-PT'
      })
    ).toBe('Lanca')
  })

  it('keeps the raw key when no locale folder answers it', () => {
    expect(
      resolveLocalizedManifestName({name: '__MSG_extName__'}, [root], {
        systemLocale: 'de-DE'
      })
    ).toBe('__MSG_extName__')

    expect(
      resolveLocalizedManifestName(
        {name: '__MSG_missing__', default_locale: 'en'},
        [root],
        {systemLocale: 'en-US'}
      )
    ).toBe('__MSG_missing__')
  })

  it('prints the stand-in instead of the key when one is given', () => {
    expect(
      resolveLocalizedManifestName({name: '__MSG_missing__'}, [root], {
        whenUnresolved: 'my-extension',
        systemLocale: 'en-US'
      })
    ).toBe('my-extension')
  })

  it('tries every root in order and skips an empty one', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-bare-'))

    try {
      expect(
        resolveLocalizedManifestName(
          {name: '__MSG_extName__', default_locale: 'en'},
          ['', bare, root]
        )
      ).toBe('Lance')
    } finally {
      fs.rmSync(bare, {recursive: true, force: true})
    }
  })

  it('passes a plain name through and answers nothing for no name', () => {
    expect(
      resolveLocalizedManifestName({name: '  My Extension '}, [root])
    ).toBe('My Extension')

    expect(resolveLocalizedManifestName({}, [root])).toBe('')
    expect(resolveLocalizedManifestName(null, [root])).toBe('')
  })
})

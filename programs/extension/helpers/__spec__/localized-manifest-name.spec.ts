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
    `﻿${JSON.stringify({extName: {message: name}})}`
  )
}

// The browser card reads the dist the runner loads, which carries _locales,
// so a __MSG_ name prints as the browser shows it.
describe('resolveLocalizedManifestName (browser runner mirror)', () => {
  let dist: string

  beforeEach(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-localized-name-'))
    writeMessages(dist, 'en', 'Lance')
    writeMessages(dist, 'pt_BR', 'Lanca BR')
  })

  afterEach(() => {
    fs.rmSync(dist, {recursive: true, force: true})
  })

  it('reads the default_locale value, BOM included', () => {
    expect(
      resolveLocalizedManifestName(
        {name: '__MSG_extName__', default_locale: 'en'},
        [dist],
        {systemLocale: 'de-DE'}
      )
    ).toBe('Lance')
  })

  it('falls back to the reader language and then keeps the key', () => {
    expect(
      resolveLocalizedManifestName({name: '__MSG_extName__'}, [dist], {
        systemLocale: 'pt-BR'
      })
    ).toBe('Lanca BR')

    expect(
      resolveLocalizedManifestName({name: '__MSG_extName__'}, [dist], {
        systemLocale: 'de-DE'
      })
    ).toBe('__MSG_extName__')
  })

  it('passes a plain name through', () => {
    expect(resolveLocalizedManifestName({name: 'My Extension'}, [dist])).toBe(
      'My Extension'
    )
  })
})

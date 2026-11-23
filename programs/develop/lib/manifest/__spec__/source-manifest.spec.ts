import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {getResolvedManifestFieldsData} from '../../../plugin-web-extension/shared/manifest-fields'
import {filterKeysForThisBrowser} from '../../manifest-utils'
import {parseAuthoredJson} from '../../parse-json-safe'
import {
  forgetManifestReads,
  readManifest,
  readManifestText
} from '../source-manifest'

const tempFolder = trackTempFolders()

function manifestFile(text: string): string {
  const file = path.join(tempFolder('source-manifest-'), 'manifest.json')
  fs.writeFileSync(file, text)

  return file
}

const thrownBy = (run: () => unknown): Error & {code?: string} => {
  try {
    run()
  } catch (error) {
    return error as Error & {code?: string}
  }

  throw new Error('nothing was thrown')
}

describe('the shared source manifest reader', () => {
  it('hands every reader of one file version the same parsed object', () => {
    const file = manifestFile('{"name": "one"}')

    expect(readManifest(file)).toBe(readManifest(file))
    expect(readManifest(file, {emptyAsObject: true})).toEqual({name: 'one'})
    expect(readManifestText(file)).toBe('{"name": "one"}')
  })

  it('sees an edit of the same size whose modified time is put back', () => {
    const file = manifestFile('{"name": "one"}')
    const {atime, mtime} = fs.statSync(file)

    expect(readManifest(file)).toEqual({name: 'one'})

    fs.writeFileSync(file, '{"name": "two"}')
    fs.utimesSync(file, atime, mtime)

    expect(readManifest(file)).toEqual({name: 'two'})
    expect(readManifestText(file)).toBe('{"name": "two"}')
  })

  it('keeps the parsed object over a new compilation that finds the same text', () => {
    const file = manifestFile('{"name": "one"}')
    const before = readManifest(file)

    forgetManifestReads()

    expect(readManifest(file)).toBe(before)
  })

  it('refuses a change to the shared object, so no reader sees another one write', () => {
    const file = manifestFile(
      '{"name": "one", "permissions": ["tabs"], "action": {"default_title": "t"}}'
    )
    const first = readManifest<{
      name: string
      permissions: string[]
      action: {default_title: string}
    }>(file)

    expect(() => {
      first.name = 'changed'
    }).toThrow(TypeError)

    expect(() => first.permissions.push('storage')).toThrow(TypeError)
    expect(() => {
      first.action.default_title = 'changed'
    }).toThrow(TypeError)

    expect(readManifest(file)).toEqual({
      name: 'one',
      permissions: ['tabs'],
      action: {default_title: 't'}
    })
  })

  it('gives a reader that filters for a browser a copy of its own', () => {
    const file = manifestFile(
      '{"name": "one", "permissions": ["tabs"], "firefox:name": "fox"}'
    )
    const mine = filterKeysForThisBrowser(readManifest(file), 'firefox')

    ;(mine.permissions as string[]).push('storage')
    mine.name = 'changed'

    expect(filterKeysForThisBrowser(readManifest(file), 'firefox')).toEqual({
      name: 'fox',
      permissions: ['tabs']
    })

    expect(JSON.parse(readManifestText(file)).permissions).toEqual(['tabs'])
  })

  it('gives each reader of the manifest fields a view of its own', () => {
    const file = manifestFile(
      JSON.stringify({
        manifest_version: 3,
        background: {service_worker: 'sw.js'},
        content_scripts: [{matches: ['<all_urls>'], js: ['a.js']}]
      })
    )
    const first = getResolvedManifestFieldsData({manifestPath: file})
    const expected = structuredClone(first)

    for (const key of Object.keys(first.scripts || {})) {
      delete (first.scripts as Record<string, unknown>)[key]
    }

    expect(getResolvedManifestFieldsData({manifestPath: file})).toEqual(
      expected
    )
  })

  it('lists a locale file added beside a manifest nobody edited', () => {
    const file = manifestFile('{"manifest_version": 3, "default_locale": "en"}')
    const messages = path.join(path.dirname(file), '_locales', 'en')

    expect(
      getResolvedManifestFieldsData({manifestPath: file}).locales
    ).toBeUndefined()

    fs.mkdirSync(messages, {recursive: true})
    fs.writeFileSync(path.join(messages, 'messages.json'), '{}')

    expect(getResolvedManifestFieldsData({manifestPath: file}).locales).toEqual(
      [path.join(messages, 'messages.json')]
    )
  })

  it('raises what a direct read raises for a manifest that is not there', () => {
    const file = path.join(tempFolder('source-manifest-'), 'manifest.json')
    const direct = thrownBy(() => fs.readFileSync(file, 'utf-8'))

    for (const read of [readManifest, readManifestText]) {
      const error = thrownBy(() => read(file))

      expect(error.code).toBe('ENOENT')
      expect(error.message).toBe(direct.message)
    }
  })

  it('raises the read error once a manifest it has read is deleted, and reads the one written back', () => {
    const file = manifestFile('{"name": "one"}')

    expect(readManifest(file)).toEqual({name: 'one'})

    fs.rmSync(file)

    expect(thrownBy(() => readManifest(file)).code).toBe('ENOENT')
    expect(thrownBy(() => readManifestText(file)).code).toBe('ENOENT')

    fs.writeFileSync(file, '{"name": "back"}')

    expect(readManifest(file)).toEqual({name: 'back'})
  })

  it.each([
    ['invalid JSON', '{"name": }', {}],
    ['a trailing comma', '{"name": "one",}', {}],
    ['an empty file', '', {}],
    [
      'a block comment on Firefox',
      '/* c */ {"name": "one"}',
      {browser: 'firefox'}
    ]
  ])('raises the parse error of %s on every read', (_title, text, options) => {
    const file = manifestFile(text)
    const direct = thrownBy(() => parseAuthoredJson(text, options))

    for (let attempt = 0; attempt < 2; attempt++) {
      const error = thrownBy(() => readManifest(file, options))

      expect(error).toBeInstanceOf(SyntaxError)
      expect(error.message).toBe(direct.message)
    }
  })

  it('reads an empty file and a block comment the way each reader asks', () => {
    const empty = manifestFile('')
    const commented = manifestFile('/* c */ {"name": "one"}')

    expect(readManifest(empty, {emptyAsObject: true})).toEqual({})
    expect(() => readManifest(empty)).toThrow(SyntaxError)
    expect(readManifest(commented, {browser: 'chrome'})).toEqual({name: 'one'})
    expect(() => readManifest(commented, {browser: 'firefox'})).toThrow(
      /Firefox does not read/
    )
  })
})

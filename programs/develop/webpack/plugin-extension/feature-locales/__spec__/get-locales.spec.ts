import * as fs from 'fs'
import * as path from 'path'
import {describe, it, beforeAll, afterAll, expect} from 'vitest'
import {getLocales} from '../get-locales'

describe('getLocales', () => {
  const tmpRoot = path.resolve(__dirname, '__tmp__')
  const manifestPath = path.join(tmpRoot, 'manifest.json')
  const localesRoot = path.join(tmpRoot, '_locales')
  const enDir = path.join(localesRoot, 'en')
  const ptDir = path.join(localesRoot, 'pt_BR')

  beforeAll(() => {
    fs.mkdirSync(enDir, {recursive: true})
    fs.mkdirSync(ptDir, {recursive: true})
    fs.writeFileSync(manifestPath, '{"name":"x"}')
    fs.writeFileSync(
      path.join(enDir, 'messages.json'),
      '{"hello":{"message":"hi"}}'
    )
    fs.writeFileSync(
      path.join(ptDir, 'messages.json'),
      '{"hello":{"message":"oi"}}'
    )
    // extra non-json files
    fs.writeFileSync(path.join(enDir, 'notes.txt'), 'note')
    fs.writeFileSync(path.join(enDir, 'logo.png'), '')
  })

  afterAll(() => {
    if (fs.existsSync(tmpRoot))
      fs.rmSync(tmpRoot, {recursive: true, force: true})
  })

  it('collects all files under _locales subfolders', () => {
    const files = getLocales(manifestPath) || []
    expect(files.some((p) => p.endsWith('/_locales/en/messages.json'))).toBe(
      true
    )
    expect(files.some((p) => p.endsWith('/_locales/pt_BR/messages.json'))).toBe(
      true
    )
    expect(files.some((p) => p.endsWith('/_locales/en/notes.txt'))).toBe(true)
    expect(files.some((p) => p.endsWith('/_locales/en/logo.png'))).toBe(true)
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

// A missing locale file is reported by its own path, so the person can go
// and fix it; an array index like "0" names nothing.
const missing = vi.hoisted(() => ({path: ''}))
vi.mock('../get-locales', async () => {
  const actual =
    await vi.importActual<typeof import('../get-locales')>('../get-locales')

  return {
    ...actual,
    getLocales: () => [missing.path]
  }
})

import {processLocaleAssets} from '../process-assets'

let root = ''
afterEach(() => {
  if (root) fs.rmSync(root, {recursive: true, force: true})

  root = ''
})

describe('processLocaleAssets', () => {
  it('names the locale file that is missing', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-locales-missing-'))
    fs.mkdirSync(path.join(root, '_locales', 'en'), {recursive: true})
    fs.writeFileSync(
      path.join(root, '_locales', 'en', 'messages.json'),
      JSON.stringify({name: {message: 'en'}})
    )

    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({default_locale: 'en'})
    )

    missing.path = path.join(root, '_locales', 'en', 'privacy.md')
    const warnings: Error[] = []
    const compilation = {errors: [], warnings, emitAsset: vi.fn()} as any
    const compiler = {
      options: {context: root},
      rspack: {WebpackError: Error}
    } as any

    processLocaleAssets(compiler, compilation, path.join(root, 'manifest.json'))

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('_locales/en/privacy.md')
    expect(warnings[0].message).not.toMatch(/listed in 0\b/)
  })

  it('leaves out a locale folder without messages.json and names it once', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-locales-no-messages-'))
    fs.mkdirSync(path.join(root, '_locales', 'en'), {recursive: true})
    fs.mkdirSync(path.join(root, '_locales', 'pt_BR'), {recursive: true})
    fs.writeFileSync(
      path.join(root, '_locales', 'en', 'messages.json'),
      JSON.stringify({name: {message: 'en'}})
    )

    fs.writeFileSync(
      path.join(root, '_locales', 'pt_BR', 'README.md'),
      'translation notes'
    )

    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({default_locale: 'en'})
    )

    missing.path = path.join(root, '_locales', 'en', 'messages.json')
    const warnings: Error[] = []
    const compilation = {errors: [], warnings, emitAsset: vi.fn()} as any
    const compiler = {
      options: {context: root},
      rspack: {WebpackError: Error}
    } as any

    processLocaleAssets(compiler, compilation, path.join(root, 'manifest.json'))

    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('LocalesFolderWithoutMessages')
    expect(warnings[0].message).toContain('FOLDER _locales/pt_BR')
    expect((warnings[0] as Error & {file?: string}).file).toBe(
      path.join(root, '_locales', 'pt_BR')
    )
  })
})

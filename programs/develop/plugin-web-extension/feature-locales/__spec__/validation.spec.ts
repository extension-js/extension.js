import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {validateLocales} from '../validation'

const makeCompiler = (context: string) => ({
  options: {context},
  rspack: {WebpackError: Error}
})
const makeCompilation = () => ({
  warnings: [] as unknown[],
  errors: [] as unknown[]
})

describe('validateLocales author-mode diagnostics (unit)', () => {
  const uniq = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const tmpRoot = path.resolve(__dirname, '__tmp_validation__', uniq)
  const manifestPath = path.join(tmpRoot, 'manifest.json')
  const prevAuthorMode = process.env.EXTENSION_AUTHOR_MODE

  beforeEach(() => {
    fs.mkdirSync(tmpRoot, {recursive: true})
    fs.writeFileSync(manifestPath, '{ this is not valid json ]')
  })

  afterEach(() => {
    if (fs.existsSync(tmpRoot))
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    if (prevAuthorMode === undefined) delete process.env.EXTENSION_AUTHOR_MODE
    else process.env.EXTENSION_AUTHOR_MODE = prevAuthorMode
    vi.restoreAllMocks()
  })

  it('reports an unparseable manifest under author mode instead of swallowing it', () => {
    process.env.EXTENSION_AUTHOR_MODE = 'true'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = validateLocales(
      makeCompiler(tmpRoot) as any,
      makeCompilation() as any,
      manifestPath
    )

    expect(result).toBe(true)
    expect(
      log.mock.calls.some(([line]) =>
        String(line).includes(
          'manifest.json could not be read for locale validation'
        )
      )
    ).toBe(true)
  })

  it('stays silent when author mode is off', () => {
    delete process.env.EXTENSION_AUTHOR_MODE
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = validateLocales(
      makeCompiler(tmpRoot) as any,
      makeCompilation() as any,
      manifestPath
    )

    expect(result).toBe(true)
    expect(
      log.mock.calls.some(([line]) =>
        String(line).includes('Locales validation detected')
      )
    ).toBe(false)
  })
})

describe('validateLocales manifest placeholder scan', () => {
  const uniq = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const tmpRoot = path.resolve(__dirname, '__tmp_placeholders__', uniq)
  const manifestPath = path.join(tmpRoot, 'manifest.json')

  const writeProject = (
    manifest: Record<string, unknown>,
    messages: Record<string, unknown>
  ) => {
    fs.mkdirSync(path.join(tmpRoot, '_locales', 'en'), {recursive: true})
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    fs.writeFileSync(
      path.join(tmpRoot, '_locales', 'en', 'messages.json'),
      JSON.stringify(messages)
    )
  }

  afterEach(() => {
    if (fs.existsSync(tmpRoot))
      fs.rmSync(tmpRoot, {recursive: true, force: true})
    vi.restoreAllMocks()
  })

  it('collects placeholder names containing @, matching Chrome', () => {
    writeProject(
      {default_locale: 'en', name: '__MSG_brand@name__'},
      {appName: {message: 'App'}}
    )
    const compilation = makeCompilation()

    const result = validateLocales(
      makeCompiler(tmpRoot) as any,
      compilation as any,
      manifestPath
    )

    expect(result).toBe(false)
    expect(String(compilation.errors[0])).toContain('brand@name')
  })

  it('passes when the @-carrying message key is defined', () => {
    writeProject(
      {default_locale: 'en', name: '__MSG_brand@name__'},
      {'brand@name': {message: 'App'}}
    )
    const compilation = makeCompilation()

    const result = validateLocales(
      makeCompiler(tmpRoot) as any,
      compilation as any,
      manifestPath
    )

    expect(result).toBe(true)
    expect(compilation.errors).toHaveLength(0)
  })

  it('never requires the predefined @@ names in messages.json', () => {
    writeProject(
      {
        default_locale: 'en',
        name: '__MSG_appName__',
        description: '__MSG_@@extension_id__ and __MSG_@@ui_locale__'
      },
      {appName: {message: 'App'}}
    )
    const compilation = makeCompilation()

    const result = validateLocales(
      makeCompiler(tmpRoot) as any,
      compilation as any,
      manifestPath
    )

    expect(result).toBe(true)
    expect(compilation.errors).toHaveLength(0)
  })

  it('matches a catalog key regardless of letter case, like the browsers', () => {
    writeProject(
      {default_locale: 'en', name: '__MSG_APPNAME__'},
      {appName: {message: 'App'}}
    )
    const compilation = makeCompilation()
    const result = validateLocales(
      makeCompiler(tmpRoot) as any,
      compilation as any,
      manifestPath
    )
    expect(result).toBe(true)
    expect(compilation.errors).toHaveLength(0)
  })

  it('names a missing reference the way the author wrote it', () => {
    writeProject(
      {default_locale: 'en', name: '__MSG_AppTitle__'},
      {appName: {message: 'App'}}
    )
    const compilation = makeCompilation()
    const result = validateLocales(
      makeCompiler(tmpRoot) as any,
      compilation as any,
      manifestPath
    )
    expect(result).toBe(false)
    expect(String(compilation.errors[0])).toContain('AppTitle')
  })

  it('closes the placeholder at the first __, matching Chrome', () => {
    writeProject(
      {default_locale: 'en', name: '__MSG_a__b__'},
      {a__b: {message: 'wrong key'}}
    )
    const compilation = makeCompilation()

    const result = validateLocales(
      makeCompiler(tmpRoot) as any,
      compilation as any,
      manifestPath
    )

    expect(result).toBe(false)
    expect(String(compilation.errors[0])).toContain('"a"')
  })
})

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

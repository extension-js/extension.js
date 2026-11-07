import {Compilation} from '@rspack/core'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
import * as messages from '../messages'
import {
  APP_STORE_DESCRIPTION_LIMIT,
  CHROME_DESCRIPTION_LIMIT,
  findDescriptionLimitHit,
  WarnDescriptionLength
} from '../steps/warn-description-length'

function makeCompiler(
  browser: string,
  mode: 'development' | 'production' = 'production'
) {
  let thisCompilationFn: ((compilation: any) => void) | undefined
  let tapStage: number | undefined

  const compiler: any = {
    options: {mode},
    hooks: {
      thisCompilation: {
        tap: (_n: string, fn: any) => {
          thisCompilationFn = fn
        }
      }
    }
  }

  new WarnDescriptionLength({browser: browser as never}).apply(compiler)

  const runCompilation = (manifest: Record<string, unknown>) => {
    const warnings: any[] = []
    let processAssetsFn: (() => void) | undefined
    const compilation: any = {
      warnings,
      hooks: {
        processAssets: {
          tap: (opts: any, cb: any) => {
            tapStage = opts.stage
            processAssetsFn = cb
          }
        }
      }
    }
    setOriginalManifestContent(compilation, JSON.stringify(manifest))
    thisCompilationFn?.(compilation)
    processAssetsFn?.()

    return warnings
  }

  return {runCompilation, getTapStage: () => tapStage}
}

const over = (limit: number) => 'x'.repeat(limit + 1)

describe('findDescriptionLimitHit', () => {
  it('holds a safari build to 112 and a chrome build to 132', () => {
    expect(APP_STORE_DESCRIPTION_LIMIT).toBe(112)
    expect(CHROME_DESCRIPTION_LIMIT).toBe(132)

    const passesChrome = {description: 'x'.repeat(120)}
    expect(findDescriptionLimitHit(passesChrome, 'chrome')).toBeNull()
    expect(findDescriptionLimitHit(passesChrome, 'safari')).toMatchObject({
      kind: 'over',
      length: 120,
      rule: {limit: 112, store: 'App Store Connect'}
    })

    expect(
      findDescriptionLimitHit({description: over(132)}, 'edge')
    ).toMatchObject({kind: 'over', length: 133, rule: {limit: 132}})
  })

  it('names a missing description on safari only', () => {
    expect(findDescriptionLimitHit({name: 'x'}, 'safari')).toMatchObject({
      kind: 'missing',
      length: 0
    })

    expect(
      findDescriptionLimitHit({description: '   '}, 'safari')
    ).toMatchObject({kind: 'missing'})

    expect(findDescriptionLimitHit({name: 'x'}, 'chrome')).toBeNull()
  })

  it('stays quiet for gecko, for a localized key and at the limit', () => {
    expect(
      findDescriptionLimitHit({description: over(200)}, 'firefox')
    ).toBeNull()

    expect(
      findDescriptionLimitHit({description: '__MSG_extDescription__'}, 'safari')
    ).toBeNull()

    expect(
      findDescriptionLimitHit({description: 'x'.repeat(112)}, 'safari')
    ).toBeNull()

    expect(findDescriptionLimitHit(undefined, 'chrome')).toBeNull()
  })
})

describe('WarnDescriptionLength', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns once at report time with the length, the limit and the store', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {runCompilation, getTapStage} = makeCompiler('safari')

    const warnings = runCompilation({name: 'x', description: over(112)})

    const expected = messages.manifestDescriptionOverStoreLimit(
      'safari',
      113,
      112,
      'App Store Connect'
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toBe(expected)
    expect(warnings[0].name).toBe('ManifestDescriptionWarning')
    expect(warnings[0].file).toBe('manifest.json')
    expect(logSpy.mock.calls.map((call) => call[0])).toEqual([expected])
    expect(expected).toContain('113')
    expect(expected).toContain('Apple error 90849')
    expect(getTapStage()).toBe(Compilation.PROCESS_ASSETS_STAGE_REPORT)
  })

  it('tells a safari build without a description what Apple refuses', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const {runCompilation} = makeCompiler('safari')

    const warnings = runCompilation({name: 'x'})

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toBe(
      messages.manifestDescriptionMissingForStore(
        'safari',
        'App Store Connect',
        112
      )
    )
  })

  it('prints the same hit once per development session and every production build', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const dev = makeCompiler('chrome', 'development')
    const manifest = {name: 'x', description: over(132)}

    expect(dev.runCompilation(manifest)).toHaveLength(1)
    expect(dev.runCompilation(manifest)).toHaveLength(0)
    expect(
      dev.runCompilation({name: 'x', description: over(140)})
    ).toHaveLength(1)

    const prod = makeCompiler('chrome', 'production')
    expect(prod.runCompilation(manifest)).toHaveLength(1)
    expect(prod.runCompilation(manifest)).toHaveLength(1)
  })

  it('records nothing for a description every store takes', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {runCompilation} = makeCompiler('safari')

    expect(
      runCompilation({name: 'x', description: 'Reads pages aloud.'})
    ).toHaveLength(0)

    expect(logSpy).not.toHaveBeenCalled()
  })
})

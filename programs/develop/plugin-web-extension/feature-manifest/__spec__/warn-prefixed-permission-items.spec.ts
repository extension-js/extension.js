import {stripVTControlCharacters} from 'node:util'
import {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {diagnosticCode} from '../../../lib/diagnostic-code'
import {findPrefixedPermissionItems} from '../../../lib/manifest-utils'
import {
  asCompilation,
  asCompiler,
  type TapCallback
} from '../../__spec__/helpers/rspack-fakes'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
import {WarnPrefixedPermissionItems} from '../steps/warn-prefixed-permission-items'
import {asBrowser, type StepDiagnostic} from './helpers/manifest-fakes'

function makeCompiler(
  browser: string,
  mode: 'development' | 'production' = 'production'
) {
  let thisCompilationFn: TapCallback | undefined
  let tapStage: number | undefined

  const compiler = asCompiler({
    options: {mode},
    hooks: {
      thisCompilation: {
        tap: (_n: string, fn: TapCallback) => {
          thisCompilationFn = fn
        }
      }
    }
  })

  new WarnPrefixedPermissionItems({browser: asBrowser(browser)}).apply(compiler)

  const runCompilation = (manifest: Record<string, unknown>) => {
    const warnings: StepDiagnostic[] = []
    const errors: StepDiagnostic[] = []
    let processAssetsFn: (() => void) | undefined
    const compilation = asCompilation({
      warnings,
      errors,
      hooks: {
        processAssets: {
          tap: (opts: {stage?: number}, cb: TapCallback) => {
            tapStage = opts.stage
            processAssetsFn = cb
          }
        }
      }
    })

    setOriginalManifestContent(compilation, JSON.stringify(manifest))
    thisCompilationFn?.(compilation)
    processAssetsFn?.()

    return {warnings, errors}
  }

  return {runCompilation, getTapStage: () => tapStage}
}

describe('findPrefixedPermissionItems', () => {
  it('finds a browser prefix on an item of any of the four permission lists', () => {
    expect(
      findPrefixedPermissionItems({
        permissions: ['storage', 'chromium:sidePanel'],
        optional_permissions: ['firefox:menus'],
        host_permissions: ['safari:https://example.com/*'],
        optional_host_permissions: ['webkit:https://example.org/*']
      })
    ).toEqual([
      {
        key: 'permissions',
        item: 'chromium:sidePanel',
        prefix: 'chromium',
        value: 'sidePanel'
      },
      {
        key: 'optional_permissions',
        item: 'firefox:menus',
        prefix: 'firefox',
        value: 'menus'
      },
      {
        key: 'host_permissions',
        item: 'safari:https://example.com/*',
        prefix: 'safari',
        value: 'https://example.com/*'
      },
      {
        key: 'optional_host_permissions',
        item: 'webkit:https://example.org/*',
        prefix: 'webkit',
        value: 'https://example.org/*'
      }
    ])
  })

  it.each([
    'chromium',
    'chrome',
    'edge',
    'firefox',
    'gecko',
    'safari',
    'webkit',
    'brave',
    'zen'
  ])('reads %s: as a browser prefix', (prefix) => {
    expect(
      findPrefixedPermissionItems({permissions: [`${prefix}:tabs`]})
    ).toEqual([
      {key: 'permissions', item: `${prefix}:tabs`, prefix, value: 'tabs'}
    ])
  })

  it('reads a list a prefixed key scoped, and names that key', () => {
    expect(
      findPrefixedPermissionItems({'chromium:permissions': ['edge:tabGroups']})
    ).toEqual([
      {
        key: 'chromium:permissions',
        item: 'edge:tabGroups',
        prefix: 'edge',
        value: 'tabGroups'
      }
    ])
  })

  // chrome://favicon/ is a host a Manifest V2 extension asks for, not a prefix.
  it('takes a URL scheme, an unknown word and a bare prefix for what they are', () => {
    expect(
      findPrefixedPermissionItems({
        permissions: [
          'chrome://favicon/',
          'edge://settings/',
          'unknown:thing',
          'chromium:',
          'storage',
          7
        ],
        host_permissions: ['https://example.com:8080/*', 'file:///*'],
        externally_connectable: {ids: ['chromium:not-a-permission']}
      })
    ).toEqual([])

    expect(findPrefixedPermissionItems(undefined)).toEqual([])
  })
})

describe('WarnPrefixedPermissionItems', () => {
  const manifest = {
    manifest_version: 3,
    permissions: ['storage', 'chromium:sidePanel', 'firefox:menus']
  }

  it.each([
    ['chrome', 'kept as sidePanel', 'left out of this chrome build'],
    ['firefox', 'left out of this firefox build', 'kept as menus']
  ])('warns on %s, names each item and says what the build did with it', (browser, chromium, firefox) => {
    const {runCompilation, getTapStage} = makeCompiler(browser)
    const {warnings, errors} = runCompilation(manifest)

    expect(getTapStage()).toBe(Compilation.PROCESS_ASSETS_STAGE_REPORT)
    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('PrefixedPermissionItemWarning')
    expect(warnings[0].file).toBe('manifest.json')
    expect(diagnosticCode(warnings[0])).toBe('W_MANIFEST_COMPAT')

    const text = stripVTControlCharacters(String(warnings[0].message))

    expect(text).toContain(
      'manifest.json puts a browser prefix on a permission item.'
    )

    expect(text).toContain(
      `ITEM chromium:sidePanel in permissions, ${chromium}`
    )

    expect(text).toContain(`ITEM firefox:menus in permissions, ${firefox}`)
    expect(text).toContain('"chromium:permissions": ["storage", "sidePanel"]')
    expect(text).toContain(
      'A prefixed key replaces the plain list for that browser'
    )

    expect(text).not.toContain('ITEM storage')
  })

  it('stays quiet for a manifest with no prefixed item', () => {
    const {runCompilation} = makeCompiler('chrome')

    expect(
      runCompilation({
        permissions: ['storage', 'chrome://favicon/'],
        'chromium:permissions': ['sidePanel']
      }).warnings
    ).toEqual([])
  })

  it('says it once per dev session and on every production build', () => {
    const dev = makeCompiler('chrome', 'development')

    expect(dev.runCompilation(manifest).warnings).toHaveLength(1)
    expect(dev.runCompilation(manifest).warnings).toHaveLength(0)

    const production = makeCompiler('chrome')

    expect(production.runCompilation(manifest).warnings).toHaveLength(1)
    expect(production.runCompilation(manifest).warnings).toHaveLength(1)
  })
})

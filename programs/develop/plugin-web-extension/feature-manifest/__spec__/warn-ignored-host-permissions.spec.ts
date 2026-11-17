import {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
import {
  findIgnoredHostPermissionPatterns,
  WarnIgnoredHostPermissions
} from '../steps/warn-ignored-host-permissions'

function makeCompiler(mode: 'development' | 'production' = 'production') {
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

  new WarnIgnoredHostPermissions().apply(compiler)

  const runCompilation = (manifest: Record<string, unknown>) => {
    const warnings: any[] = []
    const errors: any[] = []
    let processAssetsFn: (() => void) | undefined
    const compilation: any = {
      warnings,
      errors,
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

    return {warnings, errors}
  }

  return {runCompilation, getTapStage: () => tapStage}
}

// Measured on Chrome 151 and Firefox Nightly 160: the extension loads and
// the pattern grants no host access.
describe('findIgnoredHostPermissionPatterns', () => {
  it('finds an invalid host wildcard in either host permission list', () => {
    expect(
      findIgnoredHostPermissionPatterns({
        host_permissions: ['https://foo.*.com/*', 'https://ok.example/*'],
        optional_host_permissions: ['https://*foo.com/*']
      })
    ).toEqual([
      {key: 'host_permissions', pattern: 'https://foo.*.com/*'},
      {key: 'optional_host_permissions', pattern: 'https://*foo.com/*'}
    ])
  })

  it('reads a list scoped to a browser by a vendor prefix', () => {
    expect(
      findIgnoredHostPermissionPatterns({
        'chromium:host_permissions': ['https://foo.*.com/*']
      })
    ).toEqual([
      {key: 'chromium:host_permissions', pattern: 'https://foo.*.com/*'}
    ])
  })

  it('leaves the patterns the browsers take, and the other manifest keys', () => {
    expect(
      findIgnoredHostPermissionPatterns({
        host_permissions: [
          '<all_urls>',
          '*://*/*',
          'https://*.example.com/*',
          'http://localhost:*/*',
          'file:///*'
        ],
        content_scripts: [{matches: ['https://foo.*.com/*']}]
      })
    ).toEqual([])

    expect(findIgnoredHostPermissionPatterns(undefined)).toEqual([])
  })
})

describe('WarnIgnoredHostPermissions', () => {
  const manifest = {
    manifest_version: 3,
    host_permissions: ['https://foo.*.com/*', 'https://ok.example/*']
  }

  it('warns at the report stage, names the pattern and never fails the build', () => {
    const {runCompilation, getTapStage} = makeCompiler()
    const {warnings, errors} = runCompilation(manifest)

    expect(getTapStage()).toBe(Compilation.PROCESS_ASSETS_STAGE_REPORT)
    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('ManifestHostPermissionWarning')
    expect(warnings[0].file).toBe('manifest.json')
    expect(warnings[0].message).toContain(
      'lists host permission patterns the browser drops, so they grant no host access.'
    )

    expect(warnings[0].message).toContain(
      'PATTERN https://foo.*.com/* in host_permissions'
    )

    expect(warnings[0].message).toContain(
      'Chrome and Firefox load the extension, Chrome records no error or warning for it'
    )

    expect(warnings[0].message).not.toMatch(/refuses|won't load/)
    expect(warnings[0].message).not.toContain('ok.example')
  })

  it('stays quiet for a manifest with no such pattern', () => {
    const {runCompilation} = makeCompiler()

    expect(
      runCompilation({host_permissions: ['https://ok.example/*']}).warnings
    ).toEqual([])
  })

  it('says it once per dev session and on every production build', () => {
    const dev = makeCompiler('development')

    expect(dev.runCompilation(manifest).warnings).toHaveLength(1)
    expect(dev.runCompilation(manifest).warnings).toHaveLength(0)

    const production = makeCompiler('production')

    expect(production.runCompilation(manifest).warnings).toHaveLength(1)
    expect(production.runCompilation(manifest).warnings).toHaveLength(1)
  })
})

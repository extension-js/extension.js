import {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {setOriginalManifestContent} from '../../manifest-lib/manifest'
import * as messages from '../../messages'
import {
  findContentScriptOnlyHostAccess,
  HOST_GATED_PERMISSIONS,
  WarnContentScriptHostAccess
} from '../warn-content-script-host-access'

const base = {
  manifest_version: 3,
  name: 'x',
  version: '1.0.0',
  permissions: ['scripting', 'cookies', 'webRequest', 'storage'],
  content_scripts: [
    {matches: ['https://example.com/*'], js: ['cs.js']},
    {matches: ['https://example.com/*', 'https://example.org/*'], js: ['b.js']}
  ]
}

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

  new WarnContentScriptHostAccess({browser: browser as never}).apply(compiler)

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

describe('findContentScriptOnlyHostAccess', () => {
  it('names the host-gated permissions and the matches on a chromium build', () => {
    expect(HOST_GATED_PERMISSIONS).toEqual([
      'scripting',
      'cookies',
      'webRequest'
    ])

    for (const browser of ['chrome', 'edge', 'chromium-based']) {
      expect(findContentScriptOnlyHostAccess(base, browser)).toEqual({
        matches: ['https://example.com/*', 'https://example.org/*'],
        permissions: ['scripting', 'cookies', 'webRequest']
      })
    }

    expect(
      findContentScriptOnlyHostAccess(
        {...base, permissions: ['storage', 'cookies']},
        'chrome'
      )
    ).toMatchObject({permissions: ['cookies']})
  })

  it('stays quiet where the matches do grant the host', () => {
    for (const browser of ['firefox', 'gecko-based', 'safari']) {
      expect(findContentScriptOnlyHostAccess(base, browser)).toBeNull()
    }
  })

  it('stays quiet when the manifest names a host of its own', () => {
    for (const extra of [
      {host_permissions: ['https://example.com/*']},
      {host_permissions: ['https://elsewhere.test/*']},
      {optional_host_permissions: ['https://*/*']},
      {permissions: ['scripting', 'activeTab']},
      {optional_permissions: ['activeTab']}
    ]) {
      expect(
        findContentScriptOnlyHostAccess({...base, ...extra}, 'chrome')
      ).toBeNull()
    }
  })

  it('stays quiet without a host-gated permission or a content script', () => {
    expect(
      findContentScriptOnlyHostAccess(
        {...base, permissions: ['storage', 'tabs']},
        'chrome'
      )
    ).toBeNull()

    expect(
      findContentScriptOnlyHostAccess(
        {...base, permissions: undefined},
        'chrome'
      )
    ).toBeNull()

    expect(
      findContentScriptOnlyHostAccess(
        {...base, content_scripts: undefined},
        'chrome'
      )
    ).toBeNull()

    expect(
      findContentScriptOnlyHostAccess(
        {...base, content_scripts: [{}]},
        'chrome'
      )
    ).toBeNull()
  })

  it('leaves Manifest V2 and a manifest that is not an object alone', () => {
    expect(
      findContentScriptOnlyHostAccess({...base, manifest_version: 2}, 'chrome')
    ).toBeNull()

    expect(findContentScriptOnlyHostAccess(null, 'chrome')).toBeNull()
    expect(findContentScriptOnlyHostAccess('x', 'chrome')).toBeNull()
  })
})

describe('WarnContentScriptHostAccess', () => {
  it('warns a chrome build once with the permissions and the matches', () => {
    const {runCompilation, getTapStage} = makeCompiler('chrome')

    const warnings = runCompilation(base)

    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('ContentScriptHostAccessWarning')
    expect(warnings[0].file).toBe('manifest.json')
    expect(warnings[0].message).toBe(
      messages.contentScriptMatchesGrantNoHostOnChromium(
        ['scripting', 'cookies', 'webRequest'],
        ['https://example.com/*', 'https://example.org/*']
      )
    )

    expect(warnings[0].message).toContain('"scripting"')
    expect(warnings[0].message).toContain('https://example.org/*')
    expect(warnings[0].message).toContain('scripting.executeScript rejects')
    expect(warnings[0].message).toContain('chromium:host_permissions')
    expect(getTapStage()).toBe(Compilation.PROCESS_ASSETS_STAGE_REPORT)
  })

  it('says nothing on a firefox or a safari build', () => {
    expect(makeCompiler('firefox').runCompilation(base)).toHaveLength(0)
    expect(makeCompiler('safari').runCompilation(base)).toHaveLength(0)
  })

  it('reads a prefixed key the way the target build does', () => {
    expect(
      makeCompiler('chrome').runCompilation({
        ...base,
        'chromium:host_permissions': ['https://example.com/*']
      })
    ).toHaveLength(0)

    expect(
      makeCompiler('chrome').runCompilation({
        ...base,
        'firefox:host_permissions': ['https://example.com/*']
      })
    ).toHaveLength(1)
  })

  it('names only the outcomes of the permissions the manifest declares', () => {
    const [warning] = makeCompiler('chrome').runCompilation({
      ...base,
      permissions: ['cookies']
    })

    expect(warning.message).toContain('cookies.getAll comes back empty')
    expect(warning.message).not.toContain('scripting.executeScript')
    expect(warning.message).not.toContain('webRequest')
  })

  it('warns once per dev session and on every production build', () => {
    const dev = makeCompiler('chrome', 'development')
    expect(dev.runCompilation(base)).toHaveLength(1)
    expect(dev.runCompilation(base)).toHaveLength(0)
    expect(
      dev.runCompilation({...base, permissions: ['cookies']})
    ).toHaveLength(1)

    const production = makeCompiler('chrome')
    expect(production.runCompilation(base)).toHaveLength(1)
    expect(production.runCompilation(base)).toHaveLength(1)
  })
})

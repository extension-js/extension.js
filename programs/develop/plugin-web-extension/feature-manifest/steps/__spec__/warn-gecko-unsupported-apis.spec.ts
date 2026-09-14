import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {UpdateManifest} from '../update-manifest'
import {
  findGeckoUnsupportedApiUses,
  geckoUnsupportedApis,
  type ScannableCompilation,
  usesGeckoUnsupportedApi
} from '../warn-gecko-unsupported-apis'

const SIDE_PANEL =
  'chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})\n'
const ACTION = 'chrome.action.onClicked.addListener(() => {})\n'

describe('usesGeckoUnsupportedApi', () => {
  it('matches a member read on chrome or browser, with spacing and optional chaining', () => {
    expect(
      usesGeckoUnsupportedApi('chrome.sidePanel.open({})', 'sidePanel')
    ).toBe(true)
    expect(
      usesGeckoUnsupportedApi('browser.sidePanel.open({})', 'sidePanel')
    ).toBe(true)
    expect(
      usesGeckoUnsupportedApi('chrome . sidePanel\n  .open({})', 'sidePanel')
    ).toBe(true)
    expect(
      usesGeckoUnsupportedApi('chrome.sidePanel?.open({})', 'sidePanel')
    ).toBe(true)
    expect(usesGeckoUnsupportedApi(ACTION, 'action')).toBe(true)
  })

  it('ignores a bare feature check and the look-alike namespaces', () => {
    expect(usesGeckoUnsupportedApi('if (chrome.action) {}', 'action')).toBe(
      false
    )
    expect(
      usesGeckoUnsupportedApi('chrome.browserAction.onClicked', 'action')
    ).toBe(false)
    expect(usesGeckoUnsupportedApi('chrome.actions.run()', 'action')).toBe(
      false
    )
    expect(
      usesGeckoUnsupportedApi('browser.sidebarAction.open()', 'sidePanel')
    ).toBe(false)
    expect(
      usesGeckoUnsupportedApi('const sidePanel = x.sidePanel.y', 'sidePanel')
    ).toBe(false)
  })
})

describe('geckoUnsupportedApis', () => {
  it('adds action only when the resolved manifest is Manifest V2', () => {
    expect(geckoUnsupportedApis(2)).toEqual(['sidePanel', 'action'])
    expect(geckoUnsupportedApis(3)).toEqual(['sidePanel'])
    expect(geckoUnsupportedApis(undefined)).toEqual(['sidePanel'])
  })
})

describe('findGeckoUnsupportedApiUses', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-gecko-api-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const write = (rel: string, content: string) => {
    const abs = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(abs), {recursive: true})
    fs.writeFileSync(abs, content)
    return abs
  }

  const asset = (name: string, text: string) => ({
    name,
    source: {source: () => text}
  })

  // A compilation whose chunk graph maps every module onto the given files.
  const compilationWith = (
    modules: Array<{resource?: string; modules?: any[]}>,
    assets: ReturnType<typeof asset>[] = [],
    files?: string[]
  ): ScannableCompilation => ({
    modules,
    getAssets: () => assets,
    ...(files ? {chunkGraph: {getModuleChunksIterable: () => [{files}]}} : {})
  })

  it('names the source file once per API when the chunk graph cannot say', () => {
    const sw = write(
      'background.js',
      SIDE_PANEL + 'chrome.sidePanel.open({})\n' + ACTION
    )
    const uses = findGeckoUnsupportedApiUses(
      compilationWith([{resource: sw}]),
      2
    )
    expect(uses).toEqual([
      {api: 'sidePanel', file: sw, emitted: false},
      {api: 'action', file: sw, emitted: false}
    ])
  })

  it('skips action on Manifest V3, sidePanel stays on every version', () => {
    const sw = write('background.js', SIDE_PANEL + ACTION)
    const uses = findGeckoUnsupportedApiUses(
      compilationWith([{resource: sw}]),
      3
    )
    expect(uses).toEqual([{api: 'sidePanel', file: sw, emitted: false}])
  })

  it('clears a call the emitted bundle no longer carries', () => {
    const sw = write('background.js', SIDE_PANEL + ACTION)
    const uses = findGeckoUnsupportedApiUses(
      compilationWith(
        [{resource: sw}],
        [
          asset(
            'background/scripts.js',
            'browser.browserAction.onClicked.addListener(()=>{})'
          )
        ],
        ['background/scripts.js']
      ),
      2
    )
    expect(uses).toEqual([])
  })

  it('keeps the source name when the emitted bundle still carries the call', () => {
    const sw = write('background.js', SIDE_PANEL)
    const uses = findGeckoUnsupportedApiUses(
      compilationWith(
        [{resource: sw}],
        [
          asset(
            'background/scripts.js',
            'chrome.sidePanel.setPanelBehavior({})'
          )
        ],
        ['background/scripts.js']
      ),
      2
    )
    expect(uses).toEqual([{api: 'sidePanel', file: sw, emitted: false}])
  })

  it('reads the inner modules of a concatenated module', () => {
    const sw = write('background.js', ACTION)
    const uses = findGeckoUnsupportedApiUses(
      compilationWith(
        [{modules: [{resource: sw}]}],
        [
          asset(
            'background/scripts.js',
            'chrome.action.onClicked.addListener(()=>{})'
          )
        ],
        ['background/scripts.js']
      ),
      2
    )
    expect(uses).toEqual([{api: 'action', file: sw, emitted: false}])
  })

  it('reports an emitted script no project source explains under its own name', () => {
    const vendor = write('node_modules/lib/index.js', SIDE_PANEL)
    const uses = findGeckoUnsupportedApiUses(
      compilationWith(
        [{resource: vendor}],
        [
          asset('background/scripts.js', SIDE_PANEL),
          asset('background/scripts.js.map', SIDE_PANEL)
        ],
        ['background/scripts.js']
      ),
      3
    )
    expect(uses).toEqual([
      {api: 'sidePanel', file: 'background/scripts.js', emitted: true}
    ])
  })
})

describe('UpdateManifest Gecko unsupported API warning', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-gecko-api-step-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const run = (
    mode: 'development' | 'production',
    browser: string,
    manifest: object,
    background: string
  ) => {
    const sw = path.join(tmp, 'background.js')
    fs.writeFileSync(sw, background)
    const assets: Record<string, any> = {
      'manifest.json': {source: () => JSON.stringify(manifest)},
      'background/scripts.js': {source: () => background}
    }
    const compilation: any = {
      errors: [],
      warnings: [],
      options: {mode},
      assets,
      modules: [{resource: sw}],
      getAsset: (n: string) =>
        assets[n] ? {source: assets[n].source} : undefined,
      getAssets: () =>
        Object.entries(assets).map(([name, src]) => ({name, source: src})),
      hooks: {
        processAssets: {tap: (_opts: any, fn: any) => fn()}
      },
      updateAsset: () => {},
      emitAsset: () => {}
    }
    const compiler: any = {
      options: {mode, context: tmp},
      hooks: {
        thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
      }
    }
    new UpdateManifest({
      manifestPath: path.join(tmp, 'manifest.json'),
      browser: browser as any
    }).apply(compiler)
    return (
      compilation.warnings as Array<Error & {name?: string; file?: string}>
    ).filter((w) => w.name === 'GeckoUnsupportedApiWarning')
  }

  const mv2 = {name: 'x', version: '1.0.0', manifest_version: 2}
  const mv3 = {...mv2, manifest_version: 3}

  it('warns once per API on a production firefox Manifest V2 build', () => {
    const warnings = run('production', 'firefox', mv2, SIDE_PANEL + ACTION)
    expect(warnings).toHaveLength(2)
    expect(warnings.map((w) => w.file)).toEqual([
      'background.js',
      'background.js'
    ])
    expect(warnings[0].message).toContain('background.js uses chrome.sidePanel')
    expect(warnings[0].message).toContain('sidebar_action')
    expect(warnings[1].message).toContain('background.js uses chrome.action')
    expect(warnings[1].message).toContain('browserAction')
  })

  it('warns for the gecko-based and firefox-based aliases too', () => {
    expect(run('production', 'gecko-based', mv2, ACTION)).toHaveLength(1)
    expect(run('production', 'firefox-based', mv2, ACTION)).toHaveLength(1)
  })

  it('keeps action quiet when firefox resolves to Manifest V3', () => {
    const warnings = run('production', 'firefox', mv3, SIDE_PANEL + ACTION)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('chrome.sidePanel')
  })

  it('stays quiet for chromium targets and in development', () => {
    expect(run('production', 'chrome', mv3, SIDE_PANEL + ACTION)).toEqual([])
    expect(run('production', 'edge', mv2, SIDE_PANEL + ACTION)).toEqual([])
    expect(run('development', 'firefox', mv2, SIDE_PANEL + ACTION)).toEqual([])
  })
})

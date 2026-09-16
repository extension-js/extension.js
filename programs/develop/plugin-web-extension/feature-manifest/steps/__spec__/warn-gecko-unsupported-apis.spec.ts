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

describe('usesGeckoUnsupportedApi on webkit', () => {
  it('matches an unguarded call and lets optional chaining through', () => {
    expect(usesGeckoUnsupportedApi(SIDE_PANEL, 'sidePanel', 'webkit')).toBe(
      true
    )
    expect(
      usesGeckoUnsupportedApi(
        'chrome.sidePanel?.setPanelBehavior({})',
        'sidePanel',
        'webkit'
      )
    ).toBe(false)
    expect(
      usesGeckoUnsupportedApi('if (chrome.sidePanel) {}', 'sidePanel', 'webkit')
    ).toBe(false)
  })

  it('reads the namespace, not a name that starts with it', () => {
    expect(
      usesGeckoUnsupportedApi(
        'chrome.management.getSelf()',
        'management',
        'webkit'
      )
    ).toBe(true)
    expect(
      usesGeckoUnsupportedApi(
        'chrome.managementPanel.getSelf()',
        'management',
        'webkit'
      )
    ).toBe(false)
    expect(
      usesGeckoUnsupportedApi('browser.idle.queryState(15)', 'idle', 'webkit')
    ).toBe(true)
    // The web platform has its own history, and only the extension one throws
    expect(
      usesGeckoUnsupportedApi(
        'window.history.pushState({})',
        'history',
        'webkit'
      )
    ).toBe(false)
  })
})

describe('geckoUnsupportedApis', () => {
  it('adds action only when the resolved manifest is Manifest V2', () => {
    expect(geckoUnsupportedApis(2)).toEqual(['sidePanel', 'action'])
    expect(geckoUnsupportedApis(3)).toEqual(['sidePanel'])
    expect(geckoUnsupportedApis(undefined)).toEqual(['sidePanel'])
  })

  it('checks every namespace Safari lacks, on either manifest version', () => {
    const expected = [
      'sidePanel',
      'offscreen',
      'tabGroups',
      'management',
      'userScripts',
      'identity',
      'notifications',
      'omnibox',
      'bookmarks',
      'history',
      'downloads',
      'idle'
    ]
    expect(geckoUnsupportedApis(2, 'webkit')).toEqual(expected)
    expect(geckoUnsupportedApis(3, 'webkit')).toEqual(expected)
  })

  it('leaves out action and every other API Safari implements', () => {
    const list = geckoUnsupportedApis(2, 'webkit')
    for (const api of [
      'action',
      'browserAction',
      'scripting',
      'declarativeNetRequest',
      'alarms',
      'storage',
      'contextMenus',
      'menus',
      'devtools',
      'webRequest',
      'tabs',
      'runtime'
    ]) {
      expect(list).not.toContain(api)
    }
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

  it('drops a source hit no emitted script confirms when evidence is required', () => {
    const sw = write('background.js', SIDE_PANEL)
    const compilation = compilationWith([{resource: sw}])
    expect(findGeckoUnsupportedApiUses(compilation, 3, 'webkit')).toEqual([
      {api: 'sidePanel', file: sw, emitted: false}
    ])
    expect(findGeckoUnsupportedApiUses(compilation, 3, 'webkit', true)).toEqual(
      []
    )
  })

  it('keeps a source hit the emitted script confirms when evidence is required', () => {
    const sw = write('background.js', SIDE_PANEL)
    const uses = findGeckoUnsupportedApiUses(
      compilationWith(
        [{resource: sw}],
        [asset('background/scripts.js', SIDE_PANEL)],
        ['background/scripts.js']
      ),
      3,
      'webkit',
      true
    )
    expect(uses).toEqual([{api: 'sidePanel', file: sw, emitted: false}])
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

  // emitted overrides what the build wrote, chunkGraph ties the module to it,
  // and instance replays one plugin across compiles the way a dev session does.
  interface RunOptions {
    emitted?: string
    chunkGraph?: boolean
    instance?: UpdateManifest
  }

  const run = (
    mode: 'development' | 'production',
    browser: string,
    manifest: object,
    background: string,
    options: RunOptions = {}
  ) => {
    const sw = path.join(tmp, 'background.js')
    fs.writeFileSync(sw, background)
    const assets: Record<string, any> = {
      'manifest.json': {source: () => JSON.stringify(manifest)},
      'background/scripts.js': {source: () => options.emitted ?? background}
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
      emitAsset: () => {},
      ...(options.chunkGraph
        ? {
            chunkGraph: {
              getModuleChunksIterable: () => [
                {files: ['background/scripts.js']}
              ]
            }
          }
        : {})
    }
    const compiler: any = {
      options: {mode, context: tmp},
      hooks: {
        thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
      }
    }
    const step =
      options.instance ??
      new UpdateManifest({
        manifestPath: path.join(tmp, 'manifest.json'),
        browser: browser as any
      })
    step.apply(compiler)
    return (
      compilation.warnings as Array<Error & {name?: string; file?: string}>
    ).filter(
      (w) =>
        w.name === 'GeckoUnsupportedApiWarning' ||
        w.name === 'SafariUnsupportedApiWarning'
    )
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

  it('warns on a production safari build that calls chrome.sidePanel', () => {
    const warnings = run('production', 'safari', mv3, SIDE_PANEL + ACTION)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('SafariUnsupportedApiWarning')
    expect(warnings[0].file).toBe('background.js')
    expect(warnings[0].message).toContain(
      'background.js calls chrome.sidePanel, which Safari does not have'
    )
    expect(warnings[0].message).toContain('never starts the worker')
  })

  it('keeps safari quiet for a guarded call, on either mode', () => {
    const guarded = 'chrome.sidePanel?.setPanelBehavior({})\n'
    expect(run('production', 'safari', mv3, guarded)).toEqual([])
    expect(
      run('development', 'safari', mv3, guarded, {chunkGraph: true})
    ).toEqual([])
  })

  // api, a call a background plausibly makes, and the api-specific line
  const SAFARI_MISSING: Array<[string, string, string]> = [
    [
      'offscreen',
      'chrome.offscreen.createDocument({url: "o.html"})\n',
      'no offscreen documents'
    ],
    ['tabGroups', 'chrome.tabGroups.query({})\n', 'no tab groups'],
    ['management', 'chrome.management.getSelf()\n', 'no management namespace'],
    [
      'userScripts',
      'chrome.userScripts.configureWorld({messaging: true})\n',
      'no userScripts namespace'
    ],
    [
      'identity',
      'const url = chrome.identity.getRedirectURL()\n',
      'no identity namespace'
    ],
    [
      'notifications',
      'chrome.notifications.onClicked.addListener(() => {})\n',
      'no notifications namespace'
    ],
    [
      'omnibox',
      'chrome.omnibox.onInputEntered.addListener(() => {})\n',
      'no omnibox keyword API'
    ],
    [
      'bookmarks',
      'chrome.bookmarks.onCreated.addListener(() => {})\n',
      'does not expose bookmarks'
    ],
    [
      'history',
      'chrome.history.onVisited.addListener(() => {})\n',
      'does not expose browsing history'
    ],
    [
      'downloads',
      'chrome.downloads.onChanged.addListener(() => {})\n',
      'no downloads namespace'
    ],
    [
      'idle',
      'chrome.idle.onStateChanged.addListener(() => {})\n',
      'no idle namespace'
    ]
  ]

  it.each(
    SAFARI_MISSING
  )('warns on a production safari build that calls chrome.%s', (api, source, detail) => {
    const warnings = run('production', 'safari', mv3, source)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('SafariUnsupportedApiWarning')
    expect(warnings[0].file).toBe('background.js')
    expect(warnings[0].message).toContain(
      `calls chrome.${api}, which Safari does not have`
    )
    expect(warnings[0].message).toContain(detail)
    expect(warnings[0].message).toContain('EXTENSION_PUBLIC_BROWSER')
    expect(warnings[0].message).toContain(`chrome.${api}?.`)
  })

  it.each(
    SAFARI_MISSING
  )('stays quiet when chrome.%s is reached with optional chaining', (api, source) => {
    const guarded = source.replace(`.${api}.`, `.${api}?.`)
    expect(run('production', 'safari', mv3, guarded)).toEqual([])
  })

  it('never warns for the APIs Safari does implement', () => {
    const supported = [
      'chrome.action.onClicked.addListener(() => {})\n',
      'chrome.scripting.executeScript({})\n',
      'chrome.declarativeNetRequest.updateDynamicRules({})\n',
      'chrome.alarms.create("tick", {periodInMinutes: 1})\n',
      'chrome.storage.session.get("k")\n',
      'chrome.contextMenus.create({id: "m", title: "m"})\n',
      'chrome.devtools.panels.create("p", "", "p.html")\n',
      'chrome.webRequest.onBeforeRequest.addListener(() => {})\n',
      'chrome.tabs.query({})\n',
      'chrome.runtime.onInstalled.addListener(() => {})\n'
    ].join('')
    expect(run('production', 'safari', mv3, supported)).toEqual([])
  })

  it('warns once per missing namespace when a background calls several', () => {
    const many =
      SIDE_PANEL +
      'chrome.offscreen.createDocument({url: "o.html"})\n' +
      'chrome.management.getSelf()\n'
    const warnings = run('production', 'safari', mv3, many)
    expect(warnings).toHaveLength(3)
    expect(warnings.map((w) => w.name)).toEqual([
      'SafariUnsupportedApiWarning',
      'SafariUnsupportedApiWarning',
      'SafariUnsupportedApiWarning'
    ])
  })

  it('stays quiet for chromium targets, and for gecko in development', () => {
    expect(run('production', 'chrome', mv3, SIDE_PANEL + ACTION)).toEqual([])
    expect(run('production', 'edge', mv2, SIDE_PANEL + ACTION)).toEqual([])
    expect(
      run('development', 'chrome', mv3, SIDE_PANEL + ACTION, {
        chunkGraph: true
      })
    ).toEqual([])
    // Gecko's warning is lint-shaped, so it stays a production-build line
    // even when the emitted dev bundle carries the call.
    expect(
      run('development', 'firefox', mv2, SIDE_PANEL + ACTION, {
        chunkGraph: true
      })
    ).toEqual([])
  })

  it('warns in development when the call reaches the emitted asset', () => {
    const warnings = run('development', 'safari', mv3, SIDE_PANEL, {
      chunkGraph: true
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('SafariUnsupportedApiWarning')
    expect(warnings[0].file).toBe('background.js')
    expect(warnings[0].message).toContain(
      'background.js calls chrome.sidePanel, which Safari does not have'
    )
  })

  it('stays quiet in development when the bundler compiled the call out', () => {
    const warnings = run('development', 'safari', mv3, SIDE_PANEL, {
      chunkGraph: true,
      emitted: 'console.log("this build dropped the branch")\n'
    })
    expect(warnings).toEqual([])
  })

  it('stays quiet in development when no emitted script carries the call', () => {
    // No chunk graph, so nothing proves the call reached a built script.
    expect(run('development', 'safari', mv3, SIDE_PANEL)).toEqual([])
  })

  it('warns once for the same call across repeated dev compiles', () => {
    const step = new UpdateManifest({
      manifestPath: path.join(tmp, 'manifest.json'),
      browser: 'safari' as any
    })
    const opts = {chunkGraph: true, instance: step}
    expect(run('development', 'safari', mv3, SIDE_PANEL, opts)).toHaveLength(1)
    expect(run('development', 'safari', mv3, SIDE_PANEL, opts)).toEqual([])
    expect(run('development', 'safari', mv3, SIDE_PANEL, opts)).toEqual([])
  })

  it('still warns for a second API added later in the same dev session', () => {
    const step = new UpdateManifest({
      manifestPath: path.join(tmp, 'manifest.json'),
      browser: 'safari' as any
    })
    const opts = {chunkGraph: true, instance: step}
    expect(run('development', 'safari', mv3, SIDE_PANEL, opts)).toHaveLength(1)
    const next = run(
      'development',
      'safari',
      mv3,
      `${SIDE_PANEL}chrome.offscreen.createDocument({url: "o.html"})\n`,
      opts
    )
    expect(next).toHaveLength(1)
    expect(next[0].message).toContain('chrome.offscreen')
  })

  it('repeats the warning on every production build', () => {
    const step = new UpdateManifest({
      manifestPath: path.join(tmp, 'manifest.json'),
      browser: 'safari' as any
    })
    const opts = {chunkGraph: true, instance: step}
    expect(run('production', 'safari', mv3, SIDE_PANEL, opts)).toHaveLength(1)
    expect(run('production', 'safari', mv3, SIDE_PANEL, opts)).toHaveLength(1)
  })
})

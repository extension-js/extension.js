import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {safariMissingMemberDetails} from '../../messages'
import {UpdateManifest} from '../update-manifest'
import {
  findGeckoUnsupportedApiUses,
  geckoUnsupportedApis,
  type ScannableCompilation,
  usesGeckoUnsupportedApi,
  usesWebkitUnsupportedMember,
  webkitUnsupportedMembers
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

describe('usesWebkitUnsupportedMember', () => {
  const entryOf = (api: string, member: string) => {
    const entry = webkitUnsupportedMembers.find(
      (candidate) => candidate.api === api && candidate.member === member
    )
    if (!entry) throw new Error(`${api}.${member} is not in the member table`)

    return entry
  }

  const BADGE_COLOR = entryOf('action', 'setBadgeTextColor')
  const MANAGED = entryOf('storage', 'managed')
  const ON_SUSPEND = entryOf('runtime', 'onSuspend')

  it('matches a call on a missing function, on chrome or browser', () => {
    expect(
      usesWebkitUnsupportedMember(
        'chrome.action.setBadgeTextColor({color: "#fff"})',
        BADGE_COLOR
      )
    ).toBe(true)

    expect(
      usesWebkitUnsupportedMember(
        'browser.action.setBadgeTextColor({})',
        BADGE_COLOR
      )
    ).toBe(true)

    expect(
      usesWebkitUnsupportedMember(
        'chrome . action\n  .setBadgeTextColor({})',
        BADGE_COLOR
      )
    ).toBe(true)
  })

  it('matches a read through a missing event or sub-namespace', () => {
    expect(
      usesWebkitUnsupportedMember(
        'chrome.storage.managed.get("policy")',
        MANAGED
      )
    ).toBe(true)

    expect(
      usesWebkitUnsupportedMember(
        'chrome.runtime.onSuspend.addListener(() => {})',
        ON_SUSPEND
      )
    ).toBe(true)
  })

  it('lets optional chaining at the member through', () => {
    expect(
      usesWebkitUnsupportedMember(
        'chrome.action.setBadgeTextColor?.({})',
        BADGE_COLOR
      )
    ).toBe(false)

    expect(
      usesWebkitUnsupportedMember('chrome.storage.managed?.get("k")', MANAGED)
    ).toBe(false)

    expect(
      usesWebkitUnsupportedMember(
        'chrome.runtime.onSuspend?.addListener(() => {})',
        ON_SUSPEND
      )
    ).toBe(false)
  })

  // A guard on the namespace does not really protect a missing member, but the
  // webkit rule reads ?. as deliberate and stays quiet wherever it appears.
  it('lets optional chaining at the namespace through too', () => {
    expect(
      usesWebkitUnsupportedMember(
        'chrome.action?.setBadgeTextColor({})',
        BADGE_COLOR
      )
    ).toBe(false)
  })

  it('ignores a feature check and a name that only starts the same', () => {
    expect(
      usesWebkitUnsupportedMember(
        'typeof chrome.action.setBadgeTextColor === "function"',
        BADGE_COLOR
      )
    ).toBe(false)

    expect(
      usesWebkitUnsupportedMember('if (chrome.storage.managed) {}', MANAGED)
    ).toBe(false)

    expect(
      usesWebkitUnsupportedMember(
        'chrome.action.setBadgeTextColorAlpha({})',
        BADGE_COLOR
      )
    ).toBe(false)

    expect(
      usesWebkitUnsupportedMember(
        'chrome.runtime.onSuspendCanceled.addListener(() => {})',
        ON_SUSPEND
      )
    ).toBe(false)
  })

  it('never matches a member Safari does implement', () => {
    expect(
      usesWebkitUnsupportedMember('chrome.storage.local.get("k")', MANAGED)
    ).toBe(false)

    expect(
      usesWebkitUnsupportedMember('chrome.action.setBadgeText({})', BADGE_COLOR)
    ).toBe(false)
  })
})

describe('webkitUnsupportedMembers', () => {
  // A member on a namespace the namespace table already covers would warn
  // twice on one line, so the two lists must never overlap.
  it('never names a namespace the namespace list already covers', () => {
    const namespaces = geckoUnsupportedApis(3, 'webkit')

    for (const entry of webkitUnsupportedMembers) {
      expect(namespaces).not.toContain(entry.api)
    }
  })

  it('gives every member its own message detail', () => {
    for (const entry of webkitUnsupportedMembers) {
      expect(
        safariMissingMemberDetails[`${entry.api}.${entry.member}`]
      ).toBeTruthy()
    }
  })

  // A missing constant reads as undefined and never throws, so it is a
  // behavior difference rather than the fatal call this warning is for.
  it('lists no constant and no type, only throwing members', () => {
    for (const entry of webkitUnsupportedMembers) {
      expect(entry.member).toMatch(/^[a-z]/)
      expect(['call', 'read']).toContain(entry.kind)
    }
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

  const MANAGED_READ = 'chrome.storage.managed.get("policy")\n'
  const BADGE_CALL = 'chrome.action.setBadgeTextColor({color: "#fff"})\n'

  it('warns on a safari build that reads through a missing member', () => {
    const warnings = run('production', 'safari', mv3, MANAGED_READ)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].name).toBe('SafariUnsupportedApiWarning')
    expect(warnings[0].file).toBe('background.js')
    expect(warnings[0].message).toContain(
      'calls chrome.storage.managed, which Safari does not have'
    )

    expect(warnings[0].message).toContain('no managed storage area')
    expect(warnings[0].message).toContain('EXTENSION_PUBLIC_BROWSER')
    expect(warnings[0].message).toContain('chrome.storage.managed?.')
  })

  it('warns on a safari build that calls a missing function', () => {
    const warnings = run('production', 'safari', mv3, BADGE_CALL)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain(
      'calls chrome.action.setBadgeTextColor, which Safari does not have'
    )

    // The guard belongs at the member, since Safari has chrome.action itself
    expect(warnings[0].message).toContain('chrome.action.setBadgeTextColor?.()')
    expect(warnings[0].message).toContain(
      'so a guard on the namespace does not help'
    )
  })

  it('stays quiet when the member is reached with optional chaining', () => {
    expect(
      run('production', 'safari', mv3, 'chrome.storage.managed?.get("k")\n')
    ).toEqual([])

    expect(
      run(
        'production',
        'safari',
        mv3,
        'chrome.action.setBadgeTextColor?.({})\n'
      )
    ).toEqual([])
  })

  it('never warns for the members Safari does implement', () => {
    const supported = [
      'chrome.storage.local.get("k")\n',
      'chrome.storage.session.get("k")\n',
      'chrome.storage.sync.get("k")\n',
      'chrome.action.setBadgeText({text: "1"})\n',
      'chrome.action.setBadgeBackgroundColor({color: "#fff"})\n',
      'chrome.runtime.onInstalled.addListener(() => {})\n',
      'chrome.runtime.onStartup.addListener(() => {})\n',
      'chrome.webNavigation.onCompleted.addListener(() => {})\n',
      'chrome.declarativeNetRequest.updateDynamicRules({})\n',
      'chrome.tabs.query({})\n'
    ].join('')
    expect(run('production', 'safari', mv3, supported)).toEqual([])
  })

  // A missing constant reads as undefined rather than throwing, and a
  // Firefox-only member is not something a Chromium-first project writes.
  it('never warns for a missing constant or a Firefox-only member', () => {
    const rejected = [
      'const max = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES\n',
      'const id = chrome.declarativeNetRequest.SESSION_RULESET_ID\n',
      'chrome.menus.onShown.addListener(() => {})\n',
      'chrome.menus.getTargetElement(1)\n',
      'chrome.webRequest.filterResponseData("1")\n'
    ].join('')
    expect(run('production', 'safari', mv3, rejected)).toEqual([])
  })

  it('warns once, not twice, when the namespace itself is unsupported', () => {
    const warnings = run('production', 'safari', mv3, SIDE_PANEL)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain('chrome.sidePanel')
  })

  it('reports a namespace and a member on one file as two distinct lines', () => {
    const warnings = run('production', 'safari', mv3, SIDE_PANEL + MANAGED_READ)
    expect(warnings).toHaveLength(2)
    expect(warnings[0].message).toContain(
      'calls chrome.sidePanel, which Safari does not have'
    )

    expect(warnings[1].message).toContain(
      'calls chrome.storage.managed, which Safari does not have'
    )
  })

  it('applies the dev emitted-evidence gate to a member too', () => {
    // No chunk graph, so nothing proves the call reached a built script
    expect(run('development', 'safari', mv3, MANAGED_READ)).toEqual([])
    expect(
      run('development', 'safari', mv3, MANAGED_READ, {chunkGraph: true})
    ).toHaveLength(1)

    expect(
      run('development', 'safari', mv3, MANAGED_READ, {
        chunkGraph: true,
        emitted: 'console.log("this build dropped the branch")\n'
      })
    ).toEqual([])
  })

  it('warns once for the same member across repeated dev compiles', () => {
    const step = new UpdateManifest({
      manifestPath: path.join(tmp, 'manifest.json'),
      browser: 'safari' as any
    })
    const opts = {chunkGraph: true, instance: step}
    expect(run('development', 'safari', mv3, MANAGED_READ, opts)).toHaveLength(
      1
    )

    expect(run('development', 'safari', mv3, MANAGED_READ, opts)).toEqual([])
    const next = run(
      'development',
      'safari',
      mv3,
      MANAGED_READ + BADGE_CALL,
      opts
    )
    expect(next).toHaveLength(1)
    expect(next[0].message).toContain('chrome.action.setBadgeTextColor')
  })

  // Gecko's warning stays namespace shaped, so the member table is webkit only.
  // BADGE_CALL is read through chrome.action, which gecko already flags on
  // Manifest V2, so the Manifest V2 leg uses a namespace gecko never lists.
  it('leaves gecko untouched by the member table', () => {
    expect(
      run('production', 'firefox', mv3, MANAGED_READ + BADGE_CALL)
    ).toEqual([])

    expect(run('production', 'firefox', mv2, MANAGED_READ)).toEqual([])
    expect(run('production', 'chrome', mv3, MANAGED_READ + BADGE_CALL)).toEqual(
      []
    )
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

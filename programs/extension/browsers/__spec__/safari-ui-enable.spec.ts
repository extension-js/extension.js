// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import * as messages from '../browsers-lib/messages'
import type {BrowserLogger} from '../browsers-types'
import {packageSafariExtension} from '../run-safari/safari-launch'
import {
  builtAppPath,
  resolveSafariBuildConfig
} from '../run-safari/safari-launch/safari-config'
import {
  checkAccessibility,
  enableSafariExtension,
  pressShortcut,
  readSafariExtensionEnabled,
  readShortcut,
  readToolbarButton,
  readToolbarMenu,
  SafariUiError,
  setSafariExtensionEnabled
} from '../run-safari/safari-ui'
import {type FakeSafariTools, fakeSafariTools} from './safari-fake-tools'
import {fakeSafariUiTools} from './safari-fake-ui-tools'

const BUNDLE = 'dev.extensionjs.MyExt'

function makeApp(root: string): string {
  const app = path.join(root, 'MyExt.app')
  fs.mkdirSync(path.join(app, 'Contents', 'PlugIns', 'MyExt Extension.appex'), {
    recursive: true
  })

  return app
}

describe('enableSafariExtension', () => {
  let root: string
  let appPath: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-ui-'))
    appPath = makeApp(root)
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('runs the three steps in order for an ad-hoc build, then allows other websites', async () => {
    const tools = fakeSafariUiTools()
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools
    })

    expect(tools.calls).toEqual([
      'running',
      'alert',
      'enabled:read',
      'unsigned:on',
      `pluginkit:${path.join(appPath, 'Contents', 'PlugIns', 'MyExt Extension.appex')}`,
      'enabled:on',
      'websites:allow'
    ])

    expect(report).toMatchObject({
      enabled: true,
      listed: true,
      otherWebsites: 'Allow'
    })

    expect(
      report.steps.map((step) => [step.step, step.before, step.after])
    ).toEqual([
      ['unsigned', '0', '1'],
      ['pluginkit', null, 'registered'],
      ['enabled', '0', '1'],
      ['websites', 'Ask', 'Allow']
    ])

    expect(report.steps.every((step) => step.ok)).toBe(true)
  })

  it('skips the unsigned toggle for a team-signed build', async () => {
    const tools = fakeSafariUiTools({unsigned: 1})
    await enableSafariExtension({
      target: {bundleId: BUNDLE, developmentTeam: 'TEAM'},
      appPath,
      tools
    })

    expect(tools.calls.some((call) => call.startsWith('unsigned'))).toBe(false)
    expect(tools.calls).toContain('enabled:on')
  })

  it('touches nothing but other websites when the switch already reads on', async () => {
    const tools = fakeSafariUiTools({
      unsigned: 1,
      registered: true,
      enabled: 1,
      otherWebsites: 'Allow'
    })
    const steps: string[] = []
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools,
      onStep: (step) => steps.push(`${step.step}:${step.changed}`)
    })

    expect(tools.calls).toEqual([
      'running',
      'alert',
      'enabled:read',
      'websites:allow'
    ])

    expect(steps).toEqual(['enabled:false', 'websites:false'])
    expect(report.enabled).toBe(true)
  })

  it('starts Safari and waits for it before it reads Settings', async () => {
    const tools = fakeSafariUiTools({running: false, startsAfterPolls: 3})
    const steps: string[] = []
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools,
      onStep: (step) => steps.push(`${step.step}:${step.before}:${step.after}`)
    })

    expect(tools.calls.slice(0, 5)).toEqual([
      'running',
      'launch',
      'running',
      'running',
      'running'
    ])

    expect(tools.calls.slice(5, 7)).toEqual(['alert', 'enabled:read'])
    expect(steps[0]).toBe('safari:not running:running')
    expect(report.enabled).toBe(true)
  })

  it('names a Safari that never started instead of reading Settings', async () => {
    const tools = fakeSafariUiTools({running: false, startsAfterPolls: null})

    await expect(
      enableSafariExtension({
        target: {bundleId: BUNDLE},
        appPath,
        tools,
        startWaitMs: 600
      })
    ).rejects.toMatchObject({
      kind: 'not-running',
      message:
        'Safari is not running: it was started in the background and System Events still listed no Safari process 0.6 s later'
    })

    expect(tools.calls).not.toContain('enabled:read')
  })

  it('stops at an unsigned toggle that stays off and names the prompt that holds it', async () => {
    const tools = fakeSafariUiTools({
      unsignedSticks: true,
      blocker:
        'the macOS password prompt (SecurityAgent) is open and waits for an answer'
    })
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools,
      promptWaitMs: 30,
      promptPollMs: 5
    })

    expect(report).toMatchObject({
      enabled: false,
      reason:
        'Safari > Settings > Developer > Allow unsigned extensions still reads off 0 s after the click, and the macOS password prompt (SecurityAgent) is open and waits for an answer: answer it in Safari, then run again'
    })

    expect(tools.calls.slice(0, 5)).toEqual([
      'running',
      'alert',
      'enabled:read',
      'unsigned:on',
      'unsigned:read'
    ])
  })

  it('keeps reading the unsigned box while Safari waits for Touch ID or the password', async () => {
    const tools = fakeSafariUiTools({
      unsignedSticks: true,
      unsignedTurnsOnAfterReads: 2
    })
    const waits: number[] = []
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools,
      promptWaitMs: 2000,
      promptPollMs: 5,
      onPromptWait: (_step, seconds) => waits.push(seconds)
    })

    expect(waits).toEqual([2])
    expect(report.enabled).toBe(true)
    expect(report.steps[0]).toMatchObject({
      step: 'unsigned',
      before: '0',
      after: '1',
      ok: true
    })

    expect(tools.calls.filter((call) => call === 'unsigned:read')).toHaveLength(
      2
    )
  })

  it('says Safari waits on a prompt it cannot answer when the box never turns on', async () => {
    const tools = fakeSafariUiTools({unsignedSticks: true})
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools,
      promptWaitMs: 30,
      promptPollMs: 5
    })

    expect(report.enabled).toBe(false)
    expect(report.reason).toBe(
      'Safari > Settings > Developer > Allow unsigned extensions still reads off 0 s after the click: Safari asks for Touch ID or the password before it turns this on, and this run cannot answer that. Answer it or turn the box on by hand, then run again'
    )
  })

  it('stops before any Settings step when Safari shows an alert, and quotes it', async () => {
    const tools = fakeSafariUiTools({
      alert: {
        text: 'Safari cannot open the page because the address is invalid.',
        buttons: ['OK']
      }
    })
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools
    })

    expect(report).toMatchObject({
      enabled: false,
      reason:
        'Safari shows an alert that waits for an answer ("Safari cannot open the page because the address is invalid.", buttons OK), and it holds every step behind it: answer it in Safari, then run again'
    })

    expect(tools.calls).toEqual(['running', 'alert'])
  })

  it('names the unsigned row that drops the scripted switch and both ways out', async () => {
    const tools = fakeSafariUiTools({enabledSticks: true})
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools,
      promptWaitMs: 30,
      promptPollMs: 5
    })

    expect(report).toMatchObject({enabled: false, listed: true})
    expect(report.reason).toMatch(
      /^Safari read the switch for .* off again after the script turned it on: an unsigned row drops a scripted switch/
    )

    expect(report.reason).toMatch(/browser\.safari\.developmentTeam/)
    expect(report.steps.find((step) => step.step === 'enabled')).toMatchObject({
      before: '0',
      after: '0',
      changed: true,
      ok: false
    })

    expect(tools.calls).not.toContain('websites:allow')
  })

  it('keeps reading the switch while Safari asks to confirm the scripted click', async () => {
    const tools = fakeSafariUiTools({
      enabledSticks: true,
      enabledTurnsOnAfterReads: 2
    })
    const waits: string[] = []
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools,
      promptWaitMs: 2000,
      promptPollMs: 5,
      onPromptWait: (step, seconds) => waits.push(`${step}:${seconds}`)
    })

    expect(waits).toEqual(['enabled:2'])
    expect(report).toMatchObject({enabled: true, otherWebsites: 'Allow'})
    expect(report.steps.find((step) => step.step === 'enabled')).toMatchObject({
      before: '0',
      after: '1',
      ok: true
    })
  })

  it('quotes the prompt that holds the switch when nobody answers it', async () => {
    const blocker =
      'the macOS password prompt (coreautha) is open and waits for an answer ("Safari detected an app or service that interfered with clicking. Are you sure you want to turn on this Safari Extension? Touch ID to allow this.")'
    const tools = fakeSafariUiTools({enabledSticks: true, blocker})
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools,
      promptWaitMs: 30,
      promptPollMs: 5
    })

    expect(report.reason).toBe(
      `Safari read the switch for ${BUNDLE}.Extension (UNSIGNED)-checkbox off 0 s after the script clicked it, and ${blocker}: answer it in Safari or turn the switch on by hand in Safari > Settings > Extensions, or set browser.safari.developmentTeam in extension.config.js so the build is signed, then run again`
    )
  })

  it('cancels a prompt nobody answered and says so', async () => {
    const tools = fakeSafariUiTools({
      enabledSticks: true,
      cancelWorks: true,
      blocker:
        'the macOS password prompt (coreautha) is open and waits for an answer'
    })
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools,
      promptWaitMs: 30,
      promptPollMs: 5
    })

    expect(report.reason).toMatch(
      /then run again\. Nobody answered, so this run canceled the prompt and Safari is not held behind it$/
    )

    expect(tools.calls[tools.calls.length - 1]).toBe('cancel')
    expect(tools.state.blocker).toBeNull()
  })

  it('tells a team-signed row that drops the switch to turn it on by hand', async () => {
    const tools = fakeSafariUiTools({enabledSticks: true, registered: true})
    tools.state.unsigned = 1
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE, developmentTeam: 'ABCDE12345'},
      appPath,
      tools,
      promptWaitMs: 30,
      promptPollMs: 5
    })

    expect(report).toMatchObject({enabled: false, listed: true})
    expect(report.reason).toMatch(
      /turn it on by hand in Safari > Settings > Extensions, then run again$/
    )

    expect(report.reason).not.toMatch(/developmentTeam/)
  })

  it('reports the row missing instead of pretending it was ticked', async () => {
    const tools = fakeSafariUiTools({pluginkitFails: true})
    const report = await enableSafariExtension({
      target: {bundleId: BUNDLE},
      appPath,
      tools
    })

    expect(report).toMatchObject({enabled: false, listed: false})
    expect(
      report.steps.find((step) => step.step === 'pluginkit')
    ).toMatchObject({
      ok: false,
      detail: 'pluginkit: refused'
    })

    expect(tools.calls).not.toContain('websites:allow')
  })

  it('refuses off macOS before any script runs', async () => {
    const tools = fakeSafariUiTools({platform: 'linux'})

    await expect(
      enableSafariExtension({target: {bundleId: BUNDLE}, appPath, tools})
    ).rejects.toMatchObject({kind: 'platform'})

    expect(tools.calls).toEqual([])
  })

  it('names the host app when Accessibility is not granted', async () => {
    const tools = fakeSafariUiTools({accessibility: false, host: 'Cursor'})

    await expect(
      enableSafariExtension({target: {bundleId: BUNDLE}, appPath, tools})
    ).rejects.toMatchObject({kind: 'accessibility', host: 'Cursor'})

    const check = await checkAccessibility(tools)
    expect(check).toMatchObject({granted: false, host: 'Cursor'})
    expect(check.detail).toMatch(/assistive access/)
  })

  it('refuses an app with no appex to register', async () => {
    const tools = fakeSafariUiTools()
    const bare = path.join(root, 'Bare.app')
    fs.mkdirSync(bare, {recursive: true})

    await expect(
      enableSafariExtension({target: {bundleId: BUNDLE}, appPath: bare, tools})
    ).rejects.toBeInstanceOf(SafariUiError)
  })
})

describe('safari ui readers', () => {
  it('reads and sets the extension switch', async () => {
    const tools = fakeSafariUiTools({unsigned: 1, registered: true, enabled: 1})

    expect(await readSafariExtensionEnabled({bundleId: BUNDLE}, tools)).toEqual(
      {
        listed: true,
        enabled: true
      }
    )

    expect(
      await setSafariExtensionEnabled({bundleId: BUNDLE}, false, tools)
    ).toEqual({listed: true, enabled: false})

    expect(tools.state.enabled).toBe(0)
  })

  it('reads the toolbar button, its menu, the shortcut, and presses it', async () => {
    const tools = fakeSafariUiTools({unsigned: 1, registered: true})

    expect(await readToolbarButton({bundleId: BUNDLE}, tools)).toEqual({
      found: true,
      id: 'WebExtension-dev.extensionjs.MyExt.Extension (UNSIGNED)',
      title: 'My Ext: off',
      tooltip: 'My Ext: off',
      badge: null,
      enabled: true
    })

    expect(await readToolbarMenu({bundleId: BUNDLE}, tools)).toMatchObject({
      found: true,
      opened: true,
      items: [
        {title: 'Clear list', enabled: true},
        {title: 'Settings', enabled: true}
      ]
    })

    expect(await readShortcut({bundleId: BUNDLE}, tools)).toEqual({
      listed: true,
      shown: '⌥⇧H',
      shortcut: 'Alt+Shift+H'
    })

    expect(await pressShortcut('Alt+Shift+H', tools)).toEqual({
      shortcut: 'Alt+Shift+H',
      key: 'h',
      modifiers: ['option down', 'shift down']
    })
  })

  it('says when the button is not on the toolbar', async () => {
    const tools = fakeSafariUiTools({button: null})
    expect((await readToolbarButton({bundleId: BUNDLE}, tools)).found).toBe(
      false
    )

    expect((await readToolbarMenu({bundleId: BUNDLE}, tools)).items).toEqual([])
  })

  it('surfaces a script failure as a SafariUiError', async () => {
    const tools = fakeSafariUiTools({
      scriptFails: 'Safari Settings did not open'
    })

    await expect(readShortcut({bundleId: BUNDLE}, tools)).rejects.toMatchObject(
      {kind: 'script', message: /did not open/}
    )
  })
})

describe('dev --enable-extension through the pipeline', () => {
  let root: string
  let distDir: string

  function collectingLogger(logs: string[]): BrowserLogger {
    const push = (...args: unknown[]) => logs.push(args.map(String).join(' '))

    return {info: push, warn: push, error: push, debug: push}
  }

  async function run(host: Record<string, unknown>, tools?: FakeSafariTools) {
    fs.mkdirSync(distDir, {recursive: true})
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify({name: 'MyExt', version: '1.0.0', manifest_version: 3})
    )

    fs.mkdirSync(path.join(distDir, '..', 'extension-js', 'safari'), {
      recursive: true
    })

    fs.writeFileSync(
      path.join(distDir, '..', 'extension-js', 'safari', 'ready.json'),
      JSON.stringify({status: 'ready', browser: 'safari', command: 'dev'})
    )

    const logs: string[] = []
    const pipeline = tools || fakeSafariTools()
    const config = resolveSafariBuildConfig(
      {options: {output: {path: distDir}}} as never,
      {extension: [distDir], browser: 'safari'} as never
    )
    const appPath = builtAppPath(config)
    fs.mkdirSync(
      path.join(appPath, 'Contents', 'PlugIns', 'MyExt Extension.appex'),
      {recursive: true}
    )

    await packageSafariExtension(
      {
        extension: [distDir],
        browser: 'safari',
        tools: pipeline,
        announceDevReady: true,
        ...host
      } as never,
      distDir,
      collectingLogger(logs),
      'full'
    )

    return {logs, pipeline}
  }

  function readReady() {
    return JSON.parse(
      fs.readFileSync(
        path.join(distDir, '..', 'extension-js', 'safari', 'ready.json'),
        'utf8'
      )
    )
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-enable-'))
    distDir = path.join(root, 'dist', 'safari')
    process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'
  })

  afterEach(() => {
    delete process.env.EXTENSION_CLI_BANNER_PRINTED
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('enables after registration and before the WebDriver session, and skips the manual steps', async () => {
    const ui = fakeSafariUiTools()
    const {logs, pipeline} = await run({enableExtension: true, uiTools: ui})

    expect(ui.calls).toEqual([
      'probe',
      'running',
      'alert',
      'enabled:read',
      'unsigned:on',
      expect.stringMatching(/^pluginkit:/),
      'enabled:on',
      'websites:allow',
      'close'
    ])

    const events = pipeline.events.filter((e) => !e.startsWith('log:'))
    expect(events.indexOf('pluginkit')).toBeLessThan(
      events.indexOf('webdriver')
    )

    expect(logs).toContain(
      messages.safariEnableStep('unsigned extensions', 'off', 'on')
    )

    expect(logs).toContain(
      messages.safariEnableStep('extension switch', 'off', 'on')
    )

    expect(logs).toContain(
      messages.safariEnableStep('other websites', 'Ask', 'Allow')
    )

    expect(logs).toContain(messages.safariEnabled('MyExt', 'Allow'))
    expect(logs).not.toContain(messages.safariNextSteps('MyExt', false))
    const enabledAt = logs.indexOf(messages.safariEnabled('MyExt', 'Allow'))
    const registeredAt = logs.indexOf(messages.safariRegistered('MyExt'))
    expect(registeredAt).toBeGreaterThanOrEqual(0)
    expect(enabledAt).toBeGreaterThan(registeredAt)
  })

  it('logs the step that failed, closes Settings and names what it could not close', async () => {
    const blocker = 'a sheet is open on Safari Settings and waits for an answer'
    const ui = fakeSafariUiTools({unsignedSticks: true, blocker})
    const {logs} = await run({
      enableExtension: true,
      uiTools: ui,
      promptWaitMs: 30
    })

    expect(ui.calls).toEqual([
      'probe',
      'running',
      'alert',
      'enabled:read',
      'unsigned:on',
      'unsigned:read',
      'cancel',
      'close',
      'close'
    ])

    expect(logs).toContain(
      messages.safariEnableIncomplete(
        'MyExt',
        `Safari > Settings > Developer > Allow unsigned extensions still reads off 0 s after the click, and ${blocker}: answer it in Safari, then run again. Still open in Safari: ${blocker}, which holds the WebDriver session request until it is answered`
      )
    )
  })

  it('falls back to the manual steps and names the host when Accessibility is missing', async () => {
    const ui = fakeSafariUiTools({accessibility: false, host: 'Cursor'})
    const {logs} = await run({enableExtension: true, uiTools: ui})

    expect(ui.calls).toEqual(['probe'])
    expect(logs).toContain(messages.safariAccessibilityDenied('Cursor'))
    expect(logs).toContain(messages.safariNextSteps('MyExt', false))
    expect(
      logs.some((line) => /Privacy & Security ▸ Accessibility/.test(line))
    ).toBe(true)
  })

  it('without the flag prints the manual steps and never touches the UI', async () => {
    const ui = fakeSafariUiTools()
    const {logs} = await run({uiTools: ui})

    expect(ui.calls).toEqual([])
    expect(logs).toContain(messages.safariNextSteps('MyExt', false))
    expect(readReady().safari).toMatchObject({
      bundleId: 'dev.extensionjs.MyExt',
      extensionId: 'dev.extensionjs.MyExt.Extension',
      team: 'UNSIGNED',
      switchId: 'dev.extensionjs.MyExt.Extension (UNSIGNED)-checkbox',
      enableAttempted: false,
      step: 'not-asked',
      enabled: null,
      listed: null
    })

    expect(readReady().safari.reason).toMatch(/--enable-extension/)
  })

  it('stamps the finished enable into ready.json so no reader parses the log', async () => {
    const ui = fakeSafariUiTools()
    await run({enableExtension: true, uiTools: ui})

    expect(readReady().safari).toEqual({
      bundleId: 'dev.extensionjs.MyExt',
      extensionId: 'dev.extensionjs.MyExt.Extension',
      team: 'UNSIGNED',
      switchId: 'dev.extensionjs.MyExt.Extension (UNSIGNED)-checkbox',
      enableAttempted: true,
      step: 'done',
      enabled: true,
      listed: true,
      otherWebsites: 'Allow'
    })
  })

  it('stamps the step reached and the script error when Settings never opens', async () => {
    const detail =
      'Safari Settings did not open within 12 s of the menu click and the Command-Comma shortcut: System Events lists no Safari window at all and Terminal is frontmost'
    const ui = fakeSafariUiTools({scriptFails: detail})
    const {logs} = await run({enableExtension: true, uiTools: ui})

    expect(logs).toContain(messages.safariEnableIncomplete('MyExt', detail))
    expect(readReady().safari).toMatchObject({
      enableAttempted: true,
      step: 'accessibility',
      enabled: null,
      listed: null,
      reason: detail
    })

    expect(logs).toContain(messages.safariNextSteps('MyExt', false))
  })

  it('stamps the dropped unsigned switch with the signing way out', async () => {
    const ui = fakeSafariUiTools({enabledSticks: true})
    const {logs} = await run({
      enableExtension: true,
      uiTools: ui,
      promptWaitMs: 30
    })
    const ready = readReady()

    expect(ready.safari).toMatchObject({
      enableAttempted: true,
      step: 'enabled',
      enabled: false,
      listed: true
    })

    expect(ready.safari.reason).toMatch(/browser\.safari\.developmentTeam/)
    expect(logs.join('\n')).toMatch(/off again after the script turned it on/)
  })

  it('stamps the Accessibility refusal as the step it stopped at', async () => {
    const ui = fakeSafariUiTools({accessibility: false, host: 'Cursor'})
    await run({enableExtension: true, uiTools: ui})

    expect(readReady().safari).toMatchObject({
      enableAttempted: true,
      step: 'accessibility',
      enabled: null,
      reason: 'no Accessibility grant for Cursor'
    })
  })

  it('names an earlier bundle id of this project and says its switch does not carry over', async () => {
    const earlier = `dev.extensionjs.Hands-free.Extension(1.0)\t357049B0-4365-43EF-B7CC-874A49D2CEC9\t2026-11-05 22:24:03 +0000\t${path.join(distDir, '..', 'safari-xcode', '.derived', 'Build', 'Products', 'Release', 'Hands-free.app', 'Contents', 'PlugIns', 'Hands-free Extension.appex')}`
    const elsewhere = `com.other.Project.Extension(1.0)\tB1E43AE8-6840-4134-9920-A44A79BD2571\t2026-11-04 20:58:02 +0000\t/Users/someone/other/dist/safari-xcode/.derived/Build/Products/Release/Other.app/Contents/PlugIns/Other Extension.appex`
    const pipeline = fakeSafariTools({pluginkitRows: [earlier, elsewhere]})
    const ui = fakeSafariUiTools({unsigned: 1, registered: false})
    // The fake never lists the row for the new id, so the switch is "not listed".
    ui.pluginkitAdd = async () => ({ok: true, code: 0, output: ''})
    const {logs} = await run({enableExtension: true, uiTools: ui}, pipeline)

    expect(logs).toContain(
      messages.safariEarlierBuildListed(
        'MyExt',
        ['dev.extensionjs.Hands-free.Extension'],
        'dev.extensionjs.MyExt.Extension'
      )
    )

    const ready = readReady()
    expect(ready.safari.earlierExtensionIds).toEqual([
      'dev.extensionjs.Hands-free.Extension'
    ])

    expect(ready.safari.listed).toBe(false)
    expect(ready.safari.reason).toContain(
      "Safari's switch for dev.extensionjs.Hands-free.Extension does not carry over to dev.extensionjs.MyExt.Extension, turn that row on"
    )

    expect(
      logs.some((line) =>
        /does not carry over to dev.extensionjs.MyExt.Extension/.test(line)
      )
    ).toBe(true)
  })

  it('warns when an earlier signed build of the same id is still on in Safari', async () => {
    const registry = JSON.stringify({
      'dev.extensionjs.MyExt.Extension (JU3XAJJQ2G)': {Enabled: true},
      'dev.extensionjs.MyExt.Extension (UNSIGNED)': {Enabled: true},
      'com.other.Extension (UNSIGNED)': {Enabled: true}
    })
    const pipeline = fakeSafariTools({extensionRegistry: registry})
    const ui = fakeSafariUiTools()
    const {logs} = await run({enableExtension: true, uiTools: ui}, pipeline)

    expect(logs).toContain(messages.safariEnabled('MyExt', 'Allow'))
    expect(logs).toContain(
      messages.safariStaleSignedRowEnabled(
        'dev.extensionjs.MyExt.Extension',
        'JU3XAJJQ2G',
        'UNSIGNED'
      )
    )

    expect(pipeline.calls.extensionRegistry).toBe(1)
    expect(readReady().safari).toMatchObject({
      step: 'done',
      enabled: true,
      reason:
        'Safari also has the JU3XAJJQ2G-signed build of dev.extensionjs.MyExt.Extension turned on.'
    })
  })

  it("stays quiet about the registry when Safari's container cannot be read", async () => {
    const pipeline = fakeSafariTools()
    const ui = fakeSafariUiTools()
    const {logs} = await run({enableExtension: true, uiTools: ui}, pipeline)

    expect(pipeline.calls.extensionRegistry).toBe(1)
    expect(logs.some((line) => /turned on beside/.test(line))).toBe(false)
    expect(readReady().safari.reason).toBeUndefined()
  })
})

describe('the manual steps', () => {
  it('name the three steps and the automation window trap for an ad-hoc build', () => {
    const steps = messages.safariNextSteps('My App')
    expect(steps).toMatch(/Developer ▸ Allow unsigned extensions/)
    expect(steps).toMatch(/Extensions ▸ turn on/)
    expect(steps).toMatch(/Websites ▸ .*For other websites ▸ Allow/)
    expect(steps).toMatch(/automation window ends the WebDriver session/)
    expect(steps).toMatch(/--enable-extension/)
  })

  it('drop the unsigned toggle for a team-signed build', () => {
    const steps = messages.safariNextSteps('My App', true)
    expect(steps).not.toMatch(/unsigned/)
    expect(steps).toMatch(/1\..*Extensions ▸ turn on/)
    expect(steps).toMatch(/2\..*Websites/)
  })
})

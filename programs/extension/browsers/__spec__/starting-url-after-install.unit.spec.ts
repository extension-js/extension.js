import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {expectedChromiumExtensionId} from '../browsers-lib/banner'
import {CDPExtensionController} from '../run-chromium/cdp/cdp-extension-controller'
import {chromiumLaunchPlan} from '../run-chromium/chromium-launch/browser-config'
import {browserConfig as firefoxBrowserConfig} from '../run-firefox/firefox-launch/browser-config'
import {openStartingUrlAfterBackground} from '../run-firefox/rdp/remote-firefox/starting-url'

// A page the launch argv opens starts loading while the extension is still
// being installed, so its document_start content scripts and CSS never reach
// it. The launch opens about:blank and the debugger opens the starting URL
// once the extension's background is up.
const URL = 'https://example.com/'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function makeDist(manifest: Record<string, unknown>): string {
  const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-start-url-'))
  tempDirs.push(outPath)
  fs.writeFileSync(
    path.join(outPath, 'manifest.json'),
    JSON.stringify(manifest)
  )

  return outPath
}

describe('the launch argv', () => {
  it('opens about:blank on Chromium when the debugger can open the page later', () => {
    const plan = chromiumLaunchPlan(
      '/bin/chrome',
      ['--flag', '--remote-debugging-pipe'],
      URL
    )

    expect(plan.args).not.toContain(URL)
    expect(plan.args.at(-1)).toBe('about:blank')
  })

  it('keeps the starting url on Chromium when the debugging flags were removed', () => {
    const plan = chromiumLaunchPlan('/bin/chrome', ['--flag'], URL)

    expect(plan.args).toEqual(['--flag', URL])
  })

  it('opens a blank tab that carries the launch mark on Firefox', async () => {
    const out = makeDist({manifest_version: 3})
    const args = await firefoxBrowserConfig(
      {options: {mode: 'production', context: out, output: {path: out}}} as any,
      {extension: out, browser: 'firefox', startingUrl: URL} as any
    )

    expect(args).not.toContain(URL)
    expect(args).toContain('--url about:blank#extension-js-launch')
  })

  // Nothing navigates the marked tab in a session with no page to open, so
  // the launch names no url at all and Firefox shows what it normally would.
  it('names no url on Firefox when the session has no starting url', async () => {
    const out = makeDist({manifest_version: 3})
    const compilation = {
      options: {mode: 'production', context: out, output: {path: out}}
    } as any

    for (const options of [
      {},
      {noOpen: true},
      {noOpen: true, startingUrl: URL},
      {startingUrl: ''}
    ]) {
      const args = await firefoxBrowserConfig(compilation, {
        extension: out,
        browser: 'firefox',
        ...options
      } as any)

      expect(args).not.toContain('--url')
      expect(args).not.toContain('extension-js-launch')
      expect(args).not.toContain(URL)
    }
  })
})

describe('Chromium opens the starting url after install', () => {
  function makeController(outPath: string, targetLists: unknown[][]) {
    const controller = new CDPExtensionController({
      outPath,
      browser: 'chrome',
      cdpPort: 9222,
      extensionPaths: [outPath]
    }) as any
    const commands: Array<[string, unknown, string | undefined]> = []
    let listing = 0

    controller.cdp = {
      getTargets: vi.fn(async () => {
        const targets = targetLists[Math.min(listing, targetLists.length - 1)]
        listing += 1

        return targets
      }),
      sendCommand: vi.fn(
        async (method: string, params: unknown, sessionId?: string) => {
          commands.push([method, params, sessionId])

          return method === 'Target.attachToTarget' ? {sessionId: 's1'} : {}
        }
      )
    }

    return {controller, commands}
  }

  it("waits for the extension's background before navigating the blank launch tab", async () => {
    const outPath = makeDist({
      manifest_version: 3,
      background: {service_worker: 'sw.js'}
    })
    const id = expectedChromiumExtensionId(outPath)
    const blank = {type: 'page', targetId: 'p1', url: 'about:blank'}
    const worker = {
      type: 'service_worker',
      targetId: 'w1',
      url: `chrome-extension://${id}/sw.js`
    }
    const {controller, commands} = makeController(outPath, [
      [blank],
      [blank],
      [blank, worker]
    ])

    await expect(
      controller.openStartingUrl(URL, {intervalMs: 0})
    ).resolves.toBe('navigated')

    expect(controller.cdp.getTargets).toHaveBeenCalledTimes(4)
    expect(commands).toEqual([
      ['Target.attachToTarget', {targetId: 'p1', flatten: true}, undefined],
      ['Page.navigate', {url: URL}, 's1']
    ])
  })

  // A caller that reads something just ahead of the page hears once, right
  // before the command that starts the navigation.
  it('tells the caller once, just before it navigates or opens the tab', async () => {
    const outPath = makeDist({manifest_version: 3})
    const blank = {type: 'page', targetId: 'p1', url: 'about:blank'}

    for (const targets of [[blank], []]) {
      const {controller, commands} = makeController(outPath, [targets])
      const seen: number[] = []

      await controller.openStartingUrl(URL, {
        intervalMs: 0,
        beforeNavigate: () => seen.push(commands.length)
      })

      expect(seen).toEqual([commands.length - 1])
      expect(['Page.navigate', 'Target.createTarget']).toContain(
        commands.at(-1)?.[0]
      )
    }
  })

  it('opens a tab when the launch left no blank page', async () => {
    const outPath = makeDist({manifest_version: 3})
    const {controller, commands} = makeController(outPath, [
      [{type: 'page', targetId: 'p1', url: 'chrome://newtab/'}]
    ])

    await expect(
      controller.openStartingUrl(URL, {intervalMs: 0})
    ).resolves.toBe('opened')

    expect(commands).toEqual([['Target.createTarget', {url: URL}, undefined]])
  })
})

describe('Firefox opens the starting url after install', () => {
  const LAUNCH_TAB = {actor: 'tab1', url: 'about:blank#extension-js-launch'}

  function fakeClient(
    statuses: Array<string | undefined>,
    tabs: Array<Record<string, unknown>> = [LAUNCH_TAB]
  ) {
    const requests: Array<Record<string, unknown>> = []
    let listing = 0

    return {
      requests,
      client: {
        request: async (payload: Record<string, unknown>) => {
          requests.push(payload)

          if (payload.type === 'listAddons') {
            const status = statuses[Math.min(listing, statuses.length - 1)]
            listing += 1

            return {
              addons: [
                {id: 'x@example.com', backgroundScriptStatus: status},
                {id: 'devtools@extension.js'}
              ]
            }
          }

          if (payload.type === 'listTabs') {
            return {tabs}
          }

          if (payload.type === 'getTarget') {
            return {frame: {actor: `frame-of-${payload.to}`}}
          }

          return {}
        }
      }
    }
  }

  it('navigates the blank launch tab once the add-on background is running', async () => {
    const fake = fakeClient(['STOPPED', 'STOPPED', 'RUNNING'])

    await expect(
      openStartingUrlAfterBackground({
        client: fake.client,
        extensionId: 'x@example.com',
        url: URL,
        intervalMs: 0
      })
    ).resolves.toBe('navigated')

    const types = fake.requests.map((r) => r.type)
    expect(types.filter((t) => t === 'listAddons')).toHaveLength(3)
    expect(types.indexOf('navigateTo')).toBeGreaterThan(
      types.lastIndexOf('listAddons')
    )

    expect(fake.requests.at(-1)).toEqual({
      to: 'frame-of-tab1',
      type: 'navigateTo',
      url: URL
    })
  })

  it('does not wait on an add-on without a background', async () => {
    const fake = fakeClient([undefined])

    await expect(
      openStartingUrlAfterBackground({
        client: fake.client,
        extensionId: 'x@example.com',
        url: URL,
        intervalMs: 0
      })
    ).resolves.toBe('navigated')

    expect(fake.requests.filter((r) => r.type === 'listAddons')).toHaveLength(1)
  })

  // A tab the add-on opened reads about:blank and selected while it loads.
  // Navigating it replaced the add-on's own page with the starting URL.
  it('leaves a loading tab the add-on opened and navigates the launch tab', async () => {
    const fake = fakeClient(
      ['RUNNING'],
      [LAUNCH_TAB, {actor: 'tab2', url: 'about:blank', selected: true}]
    )

    await expect(
      openStartingUrlAfterBackground({
        client: fake.client,
        extensionId: 'x@example.com',
        url: URL,
        intervalMs: 0
      })
    ).resolves.toBe('navigated')

    expect(fake.requests.at(-1)).toEqual({
      to: 'frame-of-tab1',
      type: 'navigateTo',
      url: URL
    })
  })

  it('tells the caller once, just before the navigation is sent', async () => {
    const fake = fakeClient(['RUNNING'])
    const seen: number[] = []

    await openStartingUrlAfterBackground({
      client: fake.client,
      extensionId: 'x@example.com',
      url: URL,
      beforeNavigate: () => seen.push(fake.requests.length),
      intervalMs: 0
    })

    expect(seen).toEqual([fake.requests.length - 1])
    expect(fake.requests.at(-1)?.type).toBe('navigateTo')
  })

  it('tells the caller once before a tab of its own is opened', async () => {
    const fake = fakeClient(['RUNNING'], [])
    const order: string[] = []

    await openStartingUrlAfterBackground({
      client: fake.client,
      extensionId: 'x@example.com',
      url: URL,
      beforeNavigate: () => order.push('told'),
      openInNewTab: async () => {
        order.push('opened')

        return true
      },
      intervalMs: 0
    })

    expect(order).toEqual(['told', 'opened'])
  })

  it('opens a tab of its own when the launch tab is gone', async () => {
    const fake = fakeClient(
      ['RUNNING'],
      [
        {actor: 'tab1', url: 'moz-extension://x/options/index.html'},
        {actor: 'tab2', url: 'about:blank', selected: true}
      ]
    )
    const openInNewTab = vi.fn(async () => true)

    await expect(
      openStartingUrlAfterBackground({
        client: fake.client,
        extensionId: 'x@example.com',
        url: URL,
        openInNewTab,
        intervalMs: 0
      })
    ).resolves.toBe('opened')

    expect(openInNewTab).toHaveBeenCalledWith(URL)
    expect(fake.requests.some((r) => r.type === 'navigateTo')).toBe(false)
  })

  it('reports the page unopened when no tab can be made for it', async () => {
    const fake = fakeClient(['RUNNING'], [])

    await expect(
      openStartingUrlAfterBackground({
        client: fake.client,
        extensionId: 'x@example.com',
        url: URL,
        openInNewTab: async () => false,
        intervalMs: 0
      })
    ).resolves.toBe('unavailable')
  })
})

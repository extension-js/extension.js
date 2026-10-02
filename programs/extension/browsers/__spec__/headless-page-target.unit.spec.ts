import {describe, expect, it} from 'vitest'
import {chromiumHeadlessNoPageTarget} from '../browsers-lib/messages'
import {launchIsHeadless} from '../browsers-lib/shared-utils'
import {CDPExtensionController} from '../run-chromium/cdp/cdp-extension-controller'

const WELCOME =
  'chrome-extension://kgdaecdpfkikjncaalnmmnjjfpofkcbl/pages/welcome.html'

function controllerOverTargetSamples(samples: unknown[][]) {
  const calls: Array<{method: string; params: any}> = []
  let sample = 0
  const controller = new CDPExtensionController({
    outPath: '/p/dist/yandex',
    browser: 'yandex',
    cdpPort: 9222
  })
  ;(controller as any).cdp = {
    getTargets: async () => {
      const current = samples[Math.min(sample, samples.length - 1)]
      sample += 1

      return current
    },
    sendCommand: async (method: string, params: any) => {
      calls.push({method, params})

      return {targetId: 'made'}
    }
  }

  return {controller, calls, listCalls: () => sample}
}

describe('launchIsHeadless', () => {
  it('reads the flag off the argv the launch actually ran', () => {
    expect(launchIsHeadless(['--headless=new'])).toBe(true)
    expect(launchIsHeadless(['--headless=old'])).toBe(true)
    expect(launchIsHeadless(['--user-data-dir=/p', '--headless'])).toBe(true)
  })

  it('stays false for a headed launch', () => {
    expect(launchIsHeadless([])).toBe(false)
    expect(launchIsHeadless(['--user-data-dir=/p', '--no-first-run'])).toBe(
      false
    )

    expect(launchIsHeadless(['--headless-is-not-a-flag'])).toBe(false)
  })
})

describe('a headless session whose browser tore down its last page', () => {
  it('creates a page target when the list never carries one', async () => {
    const samples: unknown[][] = [
      [{targetId: 'sw', type: 'service_worker', url: WELCOME}],
      [{targetId: 'sw', type: 'service_worker', url: WELCOME}],
      [{targetId: 'sw', type: 'service_worker', url: WELCOME}],
      [
        {targetId: 'sw', type: 'service_worker', url: WELCOME},
        {targetId: 'made', type: 'page', url: WELCOME}
      ]
    ]
    const {controller, calls} = controllerOverTargetSamples(samples)

    await expect(
      controller.ensurePageTarget(WELCOME, {attempts: 3, intervalMs: 1})
    ).resolves.toBe('created')

    expect(calls).toEqual([
      {method: 'Target.createTarget', params: {url: WELCOME}}
    ])
  })

  it('refuses rather than claiming a page the browser tore down again', async () => {
    const {controller, calls} = controllerOverTargetSamples([
      [{targetId: 'sw', type: 'service_worker', url: WELCOME}]
    ])

    await expect(
      controller.ensurePageTarget(WELCOME, {
        attempts: 2,
        confirmAttempts: 2,
        intervalMs: 1
      })
    ).resolves.toBe('refused')

    expect(calls).toEqual([
      {method: 'Target.createTarget', params: {url: WELCOME}}
    ])
  })

  it('costs one target listing and no tab when a page is already there', async () => {
    const {controller, calls, listCalls} = controllerOverTargetSamples([
      [{targetId: 'p', type: 'page', url: 'chrome://extensions/'}]
    ])

    await expect(
      controller.ensurePageTarget(WELCOME, {attempts: 8, intervalMs: 1000})
    ).resolves.toBe('present')

    expect(calls).toEqual([])
    expect(listCalls()).toBe(1)
  })

  it('waits out a page that only appears on a later sample', async () => {
    const {controller, calls} = controllerOverTargetSamples([
      [{targetId: 'sw', type: 'service_worker', url: WELCOME}],
      [{targetId: 'other', type: 'other', url: ''}],
      [{targetId: 'p', type: 'page', url: 'chrome://extensions/'}]
    ])

    await expect(
      controller.ensurePageTarget(WELCOME, {attempts: 5, intervalMs: 1})
    ).resolves.toBe('present')

    expect(calls).toEqual([])
  })

  it('reports the browser it could not give a page to', () => {
    const line = chromiumHeadlessNoPageTarget('yandex')

    expect(line).toContain('yandex')
    expect(line).toContain('--headless')
    expect(line).not.toContain('chrome ')
  })
})

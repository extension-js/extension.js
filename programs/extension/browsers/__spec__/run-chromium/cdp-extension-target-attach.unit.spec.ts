import {describe, expect, it, vi} from 'vitest'
import type {CDPClient} from '../../run-chromium/cdp/cdp-client'
import {registerExtensionTargetAttach} from '../../run-chromium/cdp/cdp-extension-controller/attach'
import type {
  CdpProtocolMessage,
  CdpTargetInfo
} from '../../run-chromium/chromium-types'

function createFakeCdp(targets: CdpTargetInfo[] = []) {
  let handler: ((message: CdpProtocolMessage) => void) | undefined
  const attachToTarget = vi.fn(
    async (targetId: string) => `session-${targetId}`
  )
  const cdp = {
    onProtocolEvent: (cb: (message: CdpProtocolMessage) => void) => {
      handler = cb
    },
    attachToTarget,
    getTargets: vi.fn(async () => targets),
    sendCommand: vi.fn().mockResolvedValue({})
  } as unknown as CDPClient

  return {
    cdp,
    attachToTarget,
    created: (targetInfo: CdpTargetInfo) =>
      handler?.({method: 'Target.targetCreated', params: {targetInfo}}),
    destroyed: (targetId: string) =>
      handler?.({method: 'Target.targetDestroyed', params: {targetId}})
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('registerExtensionTargetAttach', () => {
  it('attaches the extension worker and leaves a site service worker alone', async () => {
    const {cdp, attachToTarget, created} = createFakeCdp()
    registerExtensionTargetAttach(cdp, () => 'abc')

    created({
      targetId: 't-site',
      type: 'service_worker',
      url: 'https://mail.google.com/mail/u/0/sw.js'
    })

    created({
      targetId: 't-other',
      type: 'service_worker',
      url: 'chrome-extension://zzz/background.js'
    })

    created({
      targetId: 't-page',
      type: 'page',
      url: 'chrome-extension://abc/action/index.html'
    })

    created({
      targetId: 't-own',
      type: 'service_worker',
      url: 'chrome-extension://abc/background.js'
    })

    await flush()

    expect(attachToTarget.mock.calls.map((call) => call[0])).toEqual(['t-own'])
  })

  it('parks workers seen before the id is known and attaches them on attachOwned', async () => {
    let id: string | null = null
    const {cdp, attachToTarget, created} = createFakeCdp()
    const attacher = registerExtensionTargetAttach(cdp, () => id)

    created({
      targetId: 't-early',
      type: 'service_worker',
      url: 'chrome-extension://abc/background.js'
    })

    created({
      targetId: 't-other',
      type: 'service_worker',
      url: 'chrome-extension://zzz/background.js'
    })

    await flush()
    expect(attachToTarget).not.toHaveBeenCalled()

    id = 'abc'
    await attacher.attachOwned()

    expect(attachToTarget.mock.calls.map((call) => call[0])).toEqual([
      't-early'
    ])
  })

  it('attaches each target once and again after it is destroyed and recreated', async () => {
    const own = {
      targetId: 't-own',
      type: 'service_worker',
      url: 'chrome-extension://abc/background.js'
    }
    const {cdp, attachToTarget, created, destroyed} = createFakeCdp([own])
    const attacher = registerExtensionTargetAttach(cdp, () => 'abc')

    created(own)
    await attacher.attachOwned()
    created(own)
    await flush()
    expect(attachToTarget).toHaveBeenCalledTimes(1)

    destroyed('t-own')
    created(own)
    await flush()
    expect(attachToTarget).toHaveBeenCalledTimes(2)
  })

  it('adds the extension pages only when unified logging asks for them', async () => {
    const page = {
      targetId: 't-popup',
      type: 'page',
      url: 'chrome-extension://abc/action/index.html'
    }
    const site = {targetId: 't-site', type: 'page', url: 'https://claude.ai/'}
    const {cdp, attachToTarget, created} = createFakeCdp([page, site])
    const attacher = registerExtensionTargetAttach(cdp, () => 'abc')

    await attacher.attachOwned()
    expect(attachToTarget).not.toHaveBeenCalled()

    await attacher.attachOwned({pages: true})
    created(site)
    await flush()
    expect(attachToTarget.mock.calls.map((call) => call[0])).toEqual([
      't-popup'
    ])
  })

  it('never sends Target.setAutoAttach', async () => {
    const {cdp, created} = createFakeCdp()
    const attacher = registerExtensionTargetAttach(cdp, () => 'abc')
    created({
      targetId: 't-own',
      type: 'service_worker',
      url: 'chrome-extension://abc/background.js'
    })

    await attacher.attachOwned({pages: true})

    const sendCommand = cdp.sendCommand as unknown as ReturnType<typeof vi.fn>
    expect(sendCommand).not.toHaveBeenCalledWith(
      'Target.setAutoAttach',
      expect.anything()
    )
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {stampReadyExtensionLoadRefused} from '../../browsers-lib/ready-stamp'
import {
  declaresBackgroundContext,
  loadUnpacked
} from '../../run-chromium/cdp/cdp-extension-controller/ensure'

// The CDP client rejects a failed command with Error(JSON.stringify(error)).
const cdpThatFailsWith = (error: {code?: number; message: string}) =>
  ({
    sendCommand: vi.fn(async () => {
      throw new Error(JSON.stringify(error))
    })
  }) as any

describe('loadUnpacked verdict classification (§83)', () => {
  it('reports the browser id when Chrome accepts the dist', async () => {
    const cdp = {
      sendCommand: vi.fn(async () => ({id: 'abcdefghijklmnop'}))
    } as any

    await expect(loadUnpacked(cdp, '/dist/chrome')).resolves.toEqual({
      status: 'loaded',
      extensionId: 'abcdefghijklmnop'
    })
    // Chrome names the parameter `path`; `extensionPath` is silently ignored.
    expect(cdp.sendCommand).toHaveBeenCalledWith('Extensions.loadUnpacked', {
      path: '/dist/chrome'
    })
  })

  it("carries Chrome's own refusal text as the reason", async () => {
    const cdp = cdpThatFailsWith({
      code: -32600,
      message: 'Variable $2$ used but not defined.'
    })

    await expect(loadUnpacked(cdp, '/dist/chrome')).resolves.toEqual({
      status: 'refused',
      reason: 'Variable $2$ used but not defined.'
    })
  })

  it('treats a missing method as unknown, never as a refusal', async () => {
    const cdp = cdpThatFailsWith({
      code: -32601,
      message: "'Extensions.loadUnpacked' wasn't found"
    })

    await expect(loadUnpacked(cdp, '/dist/chrome')).resolves.toEqual({
      status: 'unknown'
    })
  })

  it('retries the older parameter spelling before giving up', async () => {
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(JSON.stringify({code: -32602, message: 'Invalid parameters'}))
      )
      .mockResolvedValueOnce({id: 'secondshapeworked'})
    const cdp = {sendCommand} as any

    await expect(loadUnpacked(cdp, '/dist/chrome')).resolves.toEqual({
      status: 'loaded',
      extensionId: 'secondshapeworked'
    })
    expect(sendCommand.mock.calls[1][1]).toEqual({
      extensionPath: '/dist/chrome'
    })
  })

  it('stays unknown when both parameter shapes are rejected', async () => {
    const cdp = cdpThatFailsWith({code: -32602, message: 'Invalid parameters'})

    await expect(loadUnpacked(cdp, '/dist/chrome')).resolves.toEqual({
      status: 'unknown'
    })
  })
})

describe('declaresBackgroundContext (§83)', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'declares-bg-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  const write = (manifest: unknown) => {
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest))
    return tmp
  }

  it('is true for MV3 service workers and MV2 script lists', () => {
    expect(
      declaresBackgroundContext(write({background: {service_worker: 'sw.js'}}))
    ).toBe(true)
    expect(
      declaresBackgroundContext(write({background: {scripts: ['bg.js']}}))
    ).toBe(true)
  })

  // A theme or content-script-only extension never produces a target, so the
  // caller must not wait for one before asking the browser directly.
  it('is false when nothing will ever produce a background target', () => {
    expect(declaresBackgroundContext(write({theme: {}}))).toBe(false)
    expect(declaresBackgroundContext(write({background: {scripts: []}}))).toBe(
      false
    )
    expect(declaresBackgroundContext(path.join(tmp, 'nope'))).toBe(false)
  })
})

describe('stampReadyExtensionLoadRefused (§83)', () => {
  let tmp: string
  let outputPath: string
  let readyPath: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refused-stamp-'))
    outputPath = path.join(tmp, 'dist', 'chrome')
    readyPath = path.join(tmp, 'dist', 'extension-js', 'chrome', 'ready.json')
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  // The whole point of §83: dev used to leave this file green and empty while
  // the guest was absent from the browser.
  it('flips a green dev contract to a coded error with the reason', () => {
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        command: 'dev',
        browser: 'chrome',
        runId: 'run-A',
        errors: []
      })
    )

    stampReadyExtensionLoadRefused(outputPath, 'Could not load icon.png.')

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(ready.status).toBe('error')
    expect(ready.code).toBe('extension_load_refused')
    expect(ready.message).toContain('Could not load icon.png.')
    expect(ready.message).toContain(outputPath)
    expect(ready.extensionLoadRefusedReason).toBe('Could not load icon.png.')
    expect(typeof ready.extensionLoadRefusedAt).toBe('string')
    // Session provenance survives the stamp.
    expect(ready.runId).toBe('run-A')
  })

  it('never creates a contract where the session wrote none', () => {
    expect(() =>
      stampReadyExtensionLoadRefused(path.join(tmp, 'missing'), 'reason')
    ).not.toThrow()
    expect(fs.existsSync(path.join(tmp, 'missing'))).toBe(false)
  })
})

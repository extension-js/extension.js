import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {PassThrough} from 'stream'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  forceKillChildOnExit,
  gracefulTerminateChild,
  wasTerminatedByUs
} from '../../browsers-lib/process-teardown'
import {CDPClient} from '../../run-chromium/cdp/cdp-client'
import {stampReadyBrowserExited} from '../../run-chromium/chromium-launch'

// Family B (BUGS_TO_FIX §14-7): closing the --remote-debugging-pipe is
// Chromium's BROWSER-SHUTDOWN signal. The CDP client's cleanup used to end()
// the pipe on any dead-connection verdict (e.g. a heartbeat that timed out
// because an extension reload wedged the DevTools thread), which killed the
// user's wedged-but-alive dev browser. These specs pin the survival contract.

describe('CDPClient pipe shutdown safety', () => {
  let client: CDPClient
  let pipeIn: PassThrough
  let pipeOut: PassThrough

  beforeEach(() => {
    client = new CDPClient(0, '127.0.0.1')
    pipeIn = new PassThrough()
    pipeOut = new PassThrough()
  })

  afterEach(() => {
    pipeIn.destroy()
    pipeOut.destroy()
  })

  it('disconnect() never end()s the remote-debugging pipe (that would shut the browser down)', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)

    let finished = false
    pipeOut.on('finish', () => {
      finished = true
    })

    client.disconnect()
    await new Promise((r) => setTimeout(r, 10))

    expect(finished).toBe(false)
    expect(pipeOut.writableEnded).toBe(false)
  })

  it('disconnect() keeps draining pipe input so Chromium never blocks on a full buffer', async () => {
    await client.connectViaPipe(pipeIn, pipeOut)
    client.disconnect()

    // flowing mode = something is consuming; paused = writes would buffer
    expect(pipeIn.readableFlowing).toBe(true)
  })
})

describe('wasTerminatedByUs', () => {
  const fakeChild = () =>
    ({
      pid: 4242,
      killed: false,
      kill: () => true
    }) as unknown as import('child_process').ChildProcess

  it('marks children we ask to stop, and only those', () => {
    const ours = fakeChild()
    const dying = fakeChild()

    expect(wasTerminatedByUs(ours)).toBe(false)
    gracefulTerminateChild(ours, 'chromium')
    expect(wasTerminatedByUs(ours)).toBe(true)

    // a child we never signaled, e.g. the browser dying on its own
    expect(wasTerminatedByUs(dying)).toBe(false)
  })

  it('marks children on the force-kill exit path too', () => {
    const child = fakeChild()
    forceKillChildOnExit(child, 'chromium')
    expect(wasTerminatedByUs(child)).toBe(true)
  })
})

describe('stampReadyBrowserExited', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-stamp-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('stamps browserExitedAt/browserExitCode into an existing ready.json', () => {
    const outPath = path.join(tmp, 'dist', 'chromium')
    const metaDir = path.join(tmp, 'dist', 'extension-js', 'chromium')
    fs.mkdirSync(metaDir, {recursive: true})
    const readyPath = path.join(metaDir, 'ready.json')
    fs.writeFileSync(
      readyPath,
      JSON.stringify({status: 'ready', cdpPort: 9223})
    )

    stampReadyBrowserExited(outPath, 21)

    const ready = JSON.parse(fs.readFileSync(readyPath, 'utf-8'))
    expect(typeof ready.browserExitedAt).toBe('string')
    expect(ready.browserExitCode).toBe(21)
    expect(ready.cdpPort).toBe(9223)
  })

  it('is a no-op without an output path or ready.json', () => {
    expect(() => stampReadyBrowserExited(undefined, 0)).not.toThrow()
    expect(() =>
      stampReadyBrowserExited(path.join(tmp, 'dist', 'chromium'), 0)
    ).not.toThrow()
  })
})

import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {afterEach, describe, expect, it, vi} from 'vitest'

const fakeChild = {current: null as any}

vi.mock(
  '../run-chromium/chromium-launch/wsl-support',
  async (importOriginal) => {
    const actual: any = await importOriginal()

    return {
      ...actual,
      spawnChromiumProcess: vi.fn(async () => fakeChild.current)
    }
  }
)

vi.mock('../run-chromium/chromium-launch/process-handlers', () => ({
  setupProcessSignalHandlers: vi.fn(() => () => {})
}))

import {createChromiumContext} from '../run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from '../run-chromium/chromium-launch'

function makeChild() {
  const child: any = new EventEmitter()
  child.pid = 4242
  child.stdio = [null, null, new PassThrough()]

  return child
}

async function launchAndCrash(stderr: string, didReportReady = false) {
  fakeChild.current = makeChild()
  const logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()}
  const plugin = new ChromiumLaunchPlugin(
    {browser: 'edge', extension: ['/ext']} as any,
    createChromiumContext() as any
  )
  ;(plugin as any).logger = logger
  ;(plugin as any).didReportReady = didReportReady

  await (plugin as any).launchWithDirectSpawn('/bin/chrome', [], false)
  fakeChild.current.stdio[2].write(stderr)
  await new Promise((resolve) => setImmediate(resolve))
  fakeChild.current.emit('close', 1, null)

  return logger.error.mock.calls.map((call: unknown[]) => String(call[0]))
}

describe('a Chromium that exits before the extension loaded', () => {
  afterEach(() => {
    fakeChild.current = null
  })

  it('prints what the browser wrote, not only the exit code', async () => {
    const lines = await launchAndCrash(
      '[1:1:ERROR:ozone_platform_x11.cc(240)] Missing X server or $DISPLAY\n' +
        '[1:1:ERROR:env.cc(257)] The platform failed to initialize.  Exiting.'
    )

    expect(lines[0]).toContain('[browser] edge crashed (exit code 1)')
    expect(lines[1]).toContain('[browser] edge wrote this before it exited:')
    expect(lines[1]).toContain('Missing X server or $DISPLAY')
    expect(lines[1]).toContain('The platform failed to initialize.')
  })

  it('keeps only the last lines of a chatty browser', async () => {
    const chatter = Array.from({length: 20}, (_, i) => `line ${i}`).join('\n')
    const lines = await launchAndCrash(`${chatter}\n`)
    const tail = lines[1]

    expect(tail).toContain('line 19')
    expect(tail).toContain('line 12')
    expect(tail).not.toContain('line 11')
  })

  it('stays quiet about stderr once the extension had loaded', async () => {
    const lines = await launchAndCrash('some late chatter\n', true)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('[browser] edge crashed (exit code 1)')
  })
})

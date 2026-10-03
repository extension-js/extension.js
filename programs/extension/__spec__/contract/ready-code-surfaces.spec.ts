import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createLifecycleStream} from '../../../develop/dev-server/lifecycle-stream'
import {describeWaitError, runDevWaitMode} from '../../commands/dev-wait'
import {READY_CONTRACT_CODES} from '../../helpers/ready-contract-codes'

const here = path.dirname(fileURLToPath(import.meta.url))
const table = JSON.parse(
  fs.readFileSync(path.join(here, 'codes.json'), 'utf8')
) as {legacy: {ready: Record<string, string | string[]>}}

interface Frame {
  ok: boolean
  status: string
  value: {readyCode?: string} | null
  error: {code: string; message: string} | null
}

// The stream's browser-exited frame shipped as E_BROWSER_LAUNCH before --wait
// could name an exit, so the two differ on purpose and move only together.
const SURFACES: Record<
  string,
  {
    stamp: Record<string, unknown>
    wait: string
    streamReady: {status: string; code: string}
    streamExit: {status: string; code: string} | null
  }
> = {
  browser_exited: {
    stamp: {
      browserExitedAt: '2026-10-03T00:00:00.000Z',
      browserExitCode: 0,
      browserExitSignal: null
    },
    wait: 'E_BROWSER_EXITED',
    streamReady: {status: 'failed', code: 'E_READY_ERROR_STATUS'},
    streamExit: {status: 'browser-exited', code: 'E_BROWSER_LAUNCH'}
  },
  browser_launch_failed: {
    stamp: {
      browserLaunchFailedAt: '2026-10-03T00:00:00.000Z',
      browserLaunchFailedReason: 'spawn /nowhere/chrome EACCES'
    },
    wait: 'E_BROWSER_LAUNCH',
    streamReady: {status: 'failed', code: 'E_READY_ERROR_STATUS'},
    // Nothing exited, so the stream has no exit frame to code.
    streamExit: null
  }
}

describe('a browser verdict on the ready contract, across the surfaces that report it', () => {
  const tempDirs: string[] = []
  const priorOutput = process.env.EXTENSION_OUTPUT

  beforeEach(() => {
    // The stream only writes frames in machine mode.
    process.env.EXTENSION_OUTPUT = 'json'
  })

  afterEach(() => {
    if (priorOutput === undefined) delete process.env.EXTENSION_OUTPUT
    else process.env.EXTENSION_OUTPUT = priorOutput

    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })

  function writeContract(readyCode: string) {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'extjs-ready-surfaces-')
    )
    tempDirs.push(projectDir)
    const readyDir = path.join(projectDir, 'dist', 'extension-js', 'chromium')
    const readyPath = path.join(readyDir, 'ready.json')
    fs.mkdirSync(readyDir, {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'dev',
        browser: 'chromium',
        status: 'error',
        code: readyCode,
        message: `the session failed with ${readyCode}`,
        pid: process.pid,
        ...SURFACES[readyCode].stamp
      })
    )

    return {projectDir, readyPath}
  }

  async function waitCode(projectDir: string): Promise<string> {
    const error = await runDevWaitMode({
      pathOrRemoteUrl: projectDir,
      browsers: ['chromium'],
      waitTimeout: 2000
    }).then(
      () => null,
      (reason: unknown) => reason
    )

    return describeWaitError(error).code
  }

  async function streamFrames(readyPath: string): Promise<Frame[]> {
    const lines: string[] = []
    const stream = createLifecycleStream({
      command: 'dev',
      browser: 'chromium',
      distPath: path.join(path.dirname(readyPath), 'dist'),
      readyPath,
      write: (line) => lines.push(line)
    })

    // The two paths a session takes: the ready report after a compile, and
    // the watcher that turns the launcher's exit stamp into a frame.
    stream.ready()
    const stop = stream.watchBrowserExit(5)
    await new Promise((resolve) => setTimeout(resolve, 80))
    stop()

    return lines.map((line) => JSON.parse(line) as Frame)
  }

  it.each(
    Object.keys(SURFACES)
  )('%s reads as one pinned code on --wait, the stream and the table', async (readyCode) => {
    const expected = SURFACES[readyCode]
    const {projectDir, readyPath} = writeContract(readyCode)

    // --wait, the resolver it reads, and the published table agree.
    expect(await waitCode(projectDir)).toBe(expected.wait)
    expect(READY_CONTRACT_CODES[readyCode]).toBe(expected.wait)
    expect(table.legacy.ready[readyCode]).toBe(expected.wait)

    const frames = await streamFrames(readyPath)
    const ready = frames.filter((frame) => frame.status === 'failed')
    const exits = frames.filter((frame) => frame.status === 'browser-exited')

    // The ready report keeps one code for every contract error and carries
    // the contract's own id beside it, which is what a consumer resolves.
    expect(ready).toHaveLength(1)
    expect(ready[0].error?.code).toBe(expected.streamReady.code)
    expect(ready[0].value?.readyCode).toBe(readyCode)

    if (expected.streamExit) {
      expect(exits).toHaveLength(1)
      expect(exits[0].error?.code).toBe(expected.streamExit.code)
    } else {
      expect(exits).toEqual([])
    }

    expect(frames).toHaveLength(expected.streamExit ? 2 : 1)
  })

  it('covers every browser verdict the contract can carry', () => {
    const browserVerdicts = Object.keys(READY_CONTRACT_CODES).filter((code) =>
      code.startsWith('browser_')
    )

    expect(browserVerdicts.sort()).toEqual(Object.keys(SURFACES).sort())
  })
})

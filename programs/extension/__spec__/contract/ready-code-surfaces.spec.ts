import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createLifecycleStream} from '../../../develop/dev-server/lifecycle-stream'
import {READY_CONTRACT_CODES as ENGINE_READY_CONTRACT_CODES} from '../../../develop/dev-server/ready-contract-codes'
import {describeWaitError, runDevWaitMode} from '../../commands/dev-wait'
import {
  READY_CONTRACT_CODES,
  recordedLoadRefusal
} from '../../helpers/ready-contract-codes'

const here = path.dirname(fileURLToPath(import.meta.url))
const table = JSON.parse(
  fs.readFileSync(path.join(here, 'codes.json'), 'utf8')
) as {legacy: {ready: Record<string, string | string[]>}}

const flat = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value]

interface Frame {
  ok: boolean
  status: string
  hint?: string
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
    // What the ready report writes. A browser exit reads as its exit frame.
    streamReady?: {status: string; code: string}
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
    streamExit: {status: 'browser-exited', code: 'E_BROWSER_LAUNCH'}
  },
  browser_launch_failed: {
    stamp: {
      browserLaunchFailedAt: '2026-10-03T00:00:00.000Z',
      browserLaunchFailedReason: 'spawn /nowhere/chrome EACCES'
    },
    wait: 'E_BROWSER_LAUNCH',
    // The session lives on and the next compile tries the launch again.
    streamReady: {status: 'ready-failed', code: 'E_BROWSER_LAUNCH'},
    // Nothing exited, so the stream has no exit frame to code.
    streamExit: null
  },
  profile_locked: {
    stamp: {profileLockedAt: '2026-10-03T00:00:00.000Z'},
    wait: 'E_PROFILE_LOCKED',
    streamReady: {status: 'ready-failed', code: 'E_PROFILE_LOCKED'},
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

  function writeContract(
    readyCode: string,
    stamp: Record<string, unknown> = SURFACES[readyCode].stamp
  ) {
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
        ...stamp
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

  // The process ends with the contract still in error.
  function exitFrame(readyPath: string): Frame {
    const lines: string[] = []
    const stream = createLifecycleStream({
      command: 'dev',
      browser: 'chromium',
      distPath: path.join(path.dirname(readyPath), 'dist'),
      readyPath,
      write: (line) => lines.push(line)
    })

    stream.starting({requestedPort: 8080, port: 8080})
    stream.exited(1)

    return JSON.parse(lines[lines.length - 1]) as Frame
  }

  it.each(
    Object.keys(SURFACES)
  )('%s reads as one pinned code on --wait, the stream and the table', async (readyCode) => {
    const expected = SURFACES[readyCode]
    const {projectDir, readyPath} = writeContract(readyCode)

    // --wait, the resolver it reads, and the published table agree.
    expect(await waitCode(projectDir)).toBe(expected.wait)
    expect(READY_CONTRACT_CODES[readyCode]).toBe(expected.wait)
    expect(flat(table.legacy.ready[readyCode])[0]).toBe(expected.wait)

    const frames = await streamFrames(readyPath)

    // One frame per verdict, whichever of the report and the watcher saw it
    // first, and it carries the contract's own id, which a consumer resolves.
    expect(frames).toHaveLength(1)
    expect(frames[0].value?.readyCode).toBe(readyCode)

    if (expected.streamExit) {
      expect(frames[0].status).toBe('browser-exited')
      expect(frames[0].error?.code).toBe(expected.streamExit.code)
    } else {
      expect(frames[0].status).toBe(expected.streamReady?.status)
      expect(frames[0].error?.code).toBe(expected.streamReady?.code)
    }
  })

  it('resolves contract ids in the engine with the table --wait reads', () => {
    expect(ENGINE_READY_CONTRACT_CODES).toEqual(READY_CONTRACT_CODES)
  })

  // The launcher stamps the code it refused with, and every surface carries
  // that code instead of the id's family code. The table lists each one. The
  // dev stream reads it as ready-failed while the session lives, and as the
  // terminal status only when the process exits with it.
  const CODED_LAUNCH_FAILURES: Array<[string, 'usage' | 'failed']> = [
    ['E_BROWSER_BINARY_INVALID', 'usage'],
    ['E_BROWSER_BINARY_REQUIRED', 'usage'],
    ['E_FLAG_NOT_SUPPORTED_HERE', 'usage'],
    ['E_BROWSER_NOT_FOUND', 'failed'],
    ['E_BROWSER_START_TIMEOUT', 'failed'],
    ['E_BROWSER_CONNECT', 'failed'],
    ['E_BROWSER_CONNECTION_CLOSED', 'failed'],
    ['E_RDP_PROTOCOL', 'failed'],
    ['E_ADDON_INSTALL', 'failed'],
    ['E_PORT_UNAVAILABLE', 'failed']
  ]

  it.each(
    CODED_LAUNCH_FAILURES
  )('a launch stamped %s reads as that code on --wait and the stream, and exits as %s', async (code, status) => {
    const {projectDir, readyPath} = writeContract('browser_launch_failed', {
      browserLaunchFailedAt: '2026-10-03T00:00:00.000Z',
      browserLaunchFailedReason: `refused as ${code}`,
      browserLaunchFailedCode: code
    })

    expect(await waitCode(projectDir)).toBe(code)
    expect(flat(table.legacy.ready.browser_launch_failed)).toContain(code)

    const frames = await streamFrames(readyPath)
    expect(frames).toHaveLength(1)
    expect(frames[0].status).toBe('ready-failed')
    expect(frames[0].error?.code).toBe(code)
    expect(frames[0].hint).toContain('the next compile tries the launch again')
    expect(frames[0].value?.readyCode).toBe('browser_launch_failed')

    const last = exitFrame(readyPath)
    expect(last.status).toBe(status)
    expect(last.error?.code).toBe(code)
  })

  it('lists on the table exactly the codes a launch can be stamped with', () => {
    expect(flat(table.legacy.ready.browser_launch_failed).sort()).toEqual(
      [
        'E_BROWSER_LAUNCH',
        ...CODED_LAUNCH_FAILURES.map(([code]) => code)
      ].sort()
    )
  })

  it('covers every browser verdict the contract can carry', () => {
    const browserVerdicts = Object.keys(READY_CONTRACT_CODES).filter((code) =>
      code.startsWith('browser_')
    )

    expect([...browserVerdicts, 'profile_locked'].sort()).toEqual(
      Object.keys(SURFACES).sort()
    )
  })
})

describe('recordedLoadRefusal', () => {
  it('joins the reason and the cause as one clause with no closing period', () => {
    expect(
      recordedLoadRefusal({
        extensionLoadRefusedReason: 'TypeError: x is undefined.',
        extensionLoadRefusedCause:
          'Firefox does not load a manifest_version above 3.'
      })
    ).toBe(
      'TypeError: x is undefined. Firefox does not load a manifest_version above 3'
    )
  })

  it('reads a contract with one of them, or neither', () => {
    expect(recordedLoadRefusal({extensionLoadRefusedReason: ' no. '})).toBe(
      'no'
    )

    expect(recordedLoadRefusal({extensionLoadRefusedCause: 'why.'})).toBe('why')
    expect(recordedLoadRefusal({})).toBe('')
    expect(recordedLoadRefusal(null)).toBe('')
  })
})

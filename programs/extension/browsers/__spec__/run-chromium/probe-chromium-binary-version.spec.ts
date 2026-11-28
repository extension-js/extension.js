import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {plantBrowserStandIn} from '../../../__spec__/helpers/browser-stand-in'
import {resolveBrowserVersionLine} from '../../browsers-lib/messages'
import {
  isVersionProbeTimeout,
  probeChromiumBinaryVersion,
  probeGeckoBinaryVersion,
  VERSION_PROBE_TIMEOUT_MS
} from '../../browsers-lib/version-probe'

describe('probeChromiumBinaryVersion', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  it('reads --version from the file named, even when the target is chrome', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'extjs-probe-'))
    dirs.push(dir)
    const bin = plantBrowserStandIn(dir, 'canary', {
      version: 'Canary 999.0.1234.5'
    })

    expect(await probeChromiumBinaryVersion(bin, 'chrome')).toBe('999.0.1234.5')

    expect(await probeChromiumBinaryVersion(bin, 'chromium')).toBe(
      '999.0.1234.5'
    )

    expect(await probeChromiumBinaryVersion(bin, 'edge')).toBe('999.0.1234.5')
  })
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

// A short bound can end the stand-in before it writes a pid, or between
// creating the file and filling it. Neither names a process to look for.
function recordedPids(dir: string): Array<[string, number]> {
  const recorded: Array<[string, number]> = []

  for (const file of ['self.pid', 'child.pid']) {
    if (!existsSync(join(dir, file))) continue

    const pid = Number(readFileSync(join(dir, file), 'utf8').trim())

    if (Number.isInteger(pid) && pid > 0) recorded.push([file, pid])
  }

  return recorded
}

// Windows ends a tree through taskkill, a process of its own, so the two
// pids are gone a moment later there than after a signal.
const TREE_END_MS = process.platform === 'win32' ? 3000 : 200

// A wrapper around a browser that hangs: the probe has to stop both.
describe('a version probe of a binary that never answers', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  function hangingBrowser(): {dir: string; bin: string} {
    const dir = mkdtempSync(join(tmpdir(), 'extjs-probe-hang-'))
    dirs.push(dir)
    const bin = plantBrowserStandIn(dir, 'browser', {
      pidFile: join(dir, 'self.pid'),
      childPidFile: join(dir, 'child.pid')
    })

    return {dir, bin}
  }

  const turn = () => new Promise((done) => setImmediate(done))

  it('gives a silent binary ten seconds when the caller names no bound', async () => {
    const {dir, bin} = hangingBrowser()
    let outcome: unknown = 'pending'

    expect(VERSION_PROBE_TIMEOUT_MS).toBe(10_000)
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})

    try {
      void probeGeckoBinaryVersion(bin).catch((reason: unknown) => {
        outcome = reason
      })

      // The script is a real process: let it start before the clock moves.
      const giveUpAt = Date.now() + 10_000

      // The file exists a moment before its pid is in it, and a tree ended
      // in that moment leaves it empty, which reads as pid 0.
      const childPidWritten = () =>
        existsSync(join(dir, 'child.pid')) &&
        readFileSync(join(dir, 'child.pid'), 'utf8').trim() !== ''

      while (!childPidWritten()) {
        expect(Date.now()).toBeLessThan(giveUpAt)
        await turn()
      }

      vi.advanceTimersByTime(9999)
      await turn()
      expect(outcome).toBe('pending')

      vi.advanceTimersByTime(1)
      await turn()
    } finally {
      vi.useRealTimers()
    }

    expect(isVersionProbeTimeout(outcome)).toBe(true)
    expect(String((outcome as Error).message)).toContain(
      'did not answer within 10 seconds'
    )

    await new Promise((done) => setTimeout(done, TREE_END_MS))

    for (const [file, pid] of recordedPids(dir)) {
      expect(isAlive(pid), `${file} ${pid}`).toBe(false)
    }
  })

  it.each([
    ['gecko', 1, (bin: string) => probeGeckoBinaryVersion(bin, 1000)],
    ['chromium', 0, (bin: string) => probeChromiumBinaryVersion(bin, '', 400)]
  ])('ends the %s probe at the bound and stops the tree', async (_l, seconds, probe) => {
    const {dir, bin} = hangingBrowser()
    const started = Date.now()
    const error = await probe(bin).then(
      () => null,
      (reason: unknown) => reason as Error
    )

    expect(Date.now() - started).toBeLessThan(8000)
    expect(isVersionProbeTimeout(error)).toBe(true)
    expect((error as {code?: string}).code).toBe('E_BROWSER_BINARY_INVALID')
    expect(String(error?.message)).toContain(bin)
    expect(String(error?.message)).toContain(
      `did not answer within ${seconds} seconds`
    )

    await new Promise((done) => setTimeout(done, TREE_END_MS))

    for (const [file, pid] of recordedPids(dir)) {
      expect(isAlive(pid), `${file} ${pid}`).toBe(false)
    }
  })

  it('reads nothing, without waiting, from a binary that exits with an error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'extjs-probe-fail-'))
    dirs.push(dir)
    const bin = plantBrowserStandIn(dir, 'browser', {
      version: 'Broken 1.2.3',
      versionExitCode: 3
    })

    expect(await probeGeckoBinaryVersion(bin, 2000)).toBe('')
  })
})

describe('resolveBrowserVersionLine', () => {
  it('keeps a probed pin line verbatim', () => {
    expect(
      resolveBrowserVersionLine('chrome', '999.0.1234.5', {pinned: true})
    ).toBe('999.0.1234.5')
  })

  it('stays empty for a pin with no parseable version instead of naming another binary', () => {
    expect(resolveBrowserVersionLine('chrome', '', {pinned: true})).toBe('')
    expect(resolveBrowserVersionLine('edge', undefined, {pinned: true})).toBe(
      ''
    )
  })
})

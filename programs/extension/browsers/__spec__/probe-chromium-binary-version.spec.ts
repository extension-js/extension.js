import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {resolveBrowserVersionLine} from '../browsers-lib/messages'
import {
  isVersionProbeTimeout,
  probeChromiumBinaryVersion,
  probeGeckoBinaryVersion
} from '../browsers-lib/version-probe'

describe('probeChromiumBinaryVersion', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  // Shell-script fixture: not executable on Windows, posix-only case.
  it.skipIf(process.platform === 'win32')(
    'reads --version from the file named, even when the target is chrome',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'extjs-probe-'))
      dirs.push(dir)
      const bin = join(dir, 'canary')
      writeFileSync(bin, '#!/bin/sh\necho "Canary 999.0.1234.5"\n')
      chmodSync(bin, 0o755)

      expect(await probeChromiumBinaryVersion(bin, 'chrome')).toBe(
        '999.0.1234.5'
      )

      expect(await probeChromiumBinaryVersion(bin, 'chromium')).toBe(
        '999.0.1234.5'
      )

      expect(await probeChromiumBinaryVersion(bin, 'edge')).toBe('999.0.1234.5')
    }
  )
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

// A wrapper script whose browser hangs: the probe has to stop both.
describe.skipIf(process.platform === 'win32')(
  'a version probe of a binary that never answers',
  () => {
    const dirs: string[] = []

    afterEach(() => {
      for (const dir of dirs.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
      }
    })

    it.each([
      ['gecko', (bin: string) => probeGeckoBinaryVersion(bin, 2000)],
      ['chromium', (bin: string) => probeChromiumBinaryVersion(bin, '', 2000)]
    ])('ends the %s probe at the bound and stops the tree', async (_l, probe) => {
      const dir = mkdtempSync(join(tmpdir(), 'extjs-probe-hang-'))
      dirs.push(dir)
      const bin = join(dir, 'browser')
      writeFileSync(
        bin,
        [
          '#!/bin/sh',
          `echo $$ > "${dir}/self.pid"`,
          'sleep 600 &',
          `echo $! > "${dir}/child.pid"`,
          'wait',
          ''
        ].join('\n')
      )

      chmodSync(bin, 0o755)

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
        'did not answer within 2 seconds'
      )

      await new Promise((done) => setTimeout(done, 200))

      for (const file of ['self.pid', 'child.pid']) {
        const pid = Number(readFileSync(join(dir, file), 'utf8').trim())
        expect(isAlive(pid), `${file} ${pid}`).toBe(false)
      }
    })

    it('reads nothing, without waiting, from a binary that exits with an error', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'extjs-probe-fail-'))
      dirs.push(dir)
      const bin = join(dir, 'browser')
      writeFileSync(bin, '#!/bin/sh\necho "Broken 1.2.3"\nexit 3\n')
      chmodSync(bin, 0o755)

      expect(await probeGeckoBinaryVersion(bin, 2000)).toBe('')
    })
  }
)

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

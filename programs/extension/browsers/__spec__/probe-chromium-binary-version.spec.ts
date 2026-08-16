import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {resolveBrowserVersionLine} from '../browsers-lib/messages'
import {probeChromiumBinaryVersion} from '../browsers-lib/shared-utils'

describe('probeChromiumBinaryVersion', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  it('reads --version from the file named, even when the target is chrome', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extjs-probe-'))
    dirs.push(dir)
    const bin = join(dir, 'canary')
    writeFileSync(bin, '#!/bin/sh\necho "Canary 999.0.1234.5"\n')
    chmodSync(bin, 0o755)

    expect(probeChromiumBinaryVersion(bin, 'chrome')).toBe('999.0.1234.5')
    expect(probeChromiumBinaryVersion(bin, 'chromium')).toBe('999.0.1234.5')
    expect(probeChromiumBinaryVersion(bin, 'edge')).toBe('999.0.1234.5')
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

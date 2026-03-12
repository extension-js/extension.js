import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {afterEach, describe, expect, it} from 'vitest'

import {waitForStableManifest} from '../../run-chromium/manifest-readiness'

describe('waitForStableManifest', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      try {
        fs.rmSync(dir, {recursive: true, force: true})
      } catch {
        // ignore cleanup failures
      }
    }
  })

  it('waits until manifest.json is valid JSON for consecutive reads', async () => {
    const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-ready-'))
    tempDirs.push(outPath)
    const manifestPath = path.join(outPath, 'manifest.json')

    fs.writeFileSync(manifestPath, '', 'utf-8')

    setTimeout(() => {
      fs.writeFileSync(manifestPath, '{"name":', 'utf-8')
    }, 10)

    setTimeout(() => {
      fs.writeFileSync(manifestPath, '{"name":"x"}', 'utf-8')
    }, 30)

    const ready = await waitForStableManifest(outPath, {
      timeoutMs: 400,
      pollIntervalMs: 20
    })

    expect(ready).toBe(true)
  })

  it('returns false when manifest.json never stabilizes', async () => {
    const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-ready-'))
    tempDirs.push(outPath)
    fs.writeFileSync(path.join(outPath, 'manifest.json'), '', 'utf-8')

    const ready = await waitForStableManifest(outPath, {
      timeoutMs: 80,
      pollIntervalMs: 20
    })

    expect(ready).toBe(false)
  })
})

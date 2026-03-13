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

  it('waits until manifest-referenced files exist on disk', async () => {
    const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-ready-'))
    tempDirs.push(outPath)
    const manifestPath = path.join(outPath, 'manifest.json')

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        manifest_version: 3,
        background: {service_worker: 'background/service_worker.js'},
        side_panel: {default_path: 'sidebar/index.html'}
      }),
      'utf-8'
    )

    setTimeout(() => {
      fs.mkdirSync(path.join(outPath, 'background'), {recursive: true})
      fs.writeFileSync(
        path.join(outPath, 'background', 'service_worker.js'),
        'self;'
      )
    }, 20)

    setTimeout(() => {
      fs.mkdirSync(path.join(outPath, 'sidebar'), {recursive: true})
      fs.writeFileSync(path.join(outPath, 'sidebar', 'index.html'), '<html/>')
    }, 40)

    const ready = await waitForStableManifest(outPath, {
      timeoutMs: 500,
      pollIntervalMs: 20
    })

    expect(ready).toBe(true)
  })

  it('returns false when manifest references missing files', async () => {
    const outPath = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-ready-'))
    tempDirs.push(outPath)
    fs.writeFileSync(
      path.join(outPath, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        background: {service_worker: 'background/service_worker.js'}
      }),
      'utf-8'
    )

    const ready = await waitForStableManifest(outPath, {
      timeoutMs: 120,
      pollIntervalMs: 20
    })

    expect(ready).toBe(false)
  })
})

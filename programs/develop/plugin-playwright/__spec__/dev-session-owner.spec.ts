import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  createPlaywrightMetadataWriter,
  detectLiveDevSessionOwner
} from '../index'

function writeReadyFixture(overrides: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-owner-'))
  const readyPath = path.join(dir, 'ready.json')
  fs.writeFileSync(
    readyPath,
    JSON.stringify({
      command: 'dev',
      status: 'ready',
      pid: 424242,
      runId: 'f3a9',
      instanceId: 'alpha',
      ...overrides
    })
  )

  return readyPath
}

const alive = () => true
const dead = () => false

describe('detectLiveDevSessionOwner', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns the owner for a live same-target dev session', () => {
    const owner = detectLiveDevSessionOwner(
      writeReadyFixture({instanceExplicit: true, port: 8931}),
      alive
    )
    expect(owner).toEqual({
      pid: 424242,
      port: 8931,
      runId: 'f3a9',
      instanceId: 'alpha',
      instanceExplicit: true
    })
  })

  it('returns null when the recorded pid is gone', () => {
    expect(detectLiveDevSessionOwner(writeReadyFixture(), dead)).toBeNull()
  })

  it('returns null for a non-dev contract', () => {
    const readyPath = writeReadyFixture({command: 'build'})
    expect(detectLiveDevSessionOwner(readyPath, alive)).toBeNull()
  })

  it('returns null for a stopped session', () => {
    const readyPath = writeReadyFixture({status: 'stopped'})
    expect(detectLiveDevSessionOwner(readyPath, alive)).toBeNull()
  })

  it('returns null for its own pid', () => {
    const readyPath = writeReadyFixture({pid: process.pid})
    expect(detectLiveDevSessionOwner(readyPath, alive)).toBeNull()
  })

  it('returns null when no contract exists', () => {
    expect(
      detectLiveDevSessionOwner(path.join(os.tmpdir(), 'nope', 'ready.json'))
    ).toBeNull()
  })

  it('tolerates a missing runId and instanceId', () => {
    const readyPath = writeReadyFixture({
      runId: undefined,
      instanceId: undefined
    })
    expect(detectLiveDevSessionOwner(readyPath, alive)).toEqual({
      pid: 424242,
      port: null,
      runId: '',
      instanceId: undefined,
      instanceExplicit: false
    })
  })
})

describe('the notice about another dev session on the same target', () => {
  afterEach(() => vi.restoreAllMocks())

  it('prints once although the dev server and its plugin each open a writer', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-owner-'))
    const readyPath = path.join(
      projectDir,
      'dist',
      'extension-js',
      'chromium-owner-notice',
      'ready.json'
    )
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'dev',
        status: 'ready',
        pid: process.ppid,
        runId: 'owner-notice-run'
      })
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const options = {
      packageJsonDir: projectDir,
      browser: 'chromium-owner-notice',
      command: 'dev' as const,
      distPath: path.join(projectDir, 'dist', 'chromium-owner-notice'),
      manifestPath: path.join(projectDir, 'manifest.json')
    }
    createPlaywrightMetadataWriter(options)
    createPlaywrightMetadataWriter(options)

    const notices = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('owner-notice-run'))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain(
      'Another dev session is already writing dist/chromium-owner-notice'
    )

    fs.rmSync(projectDir, {recursive: true, force: true})
  })

  it('prints although both sessions asked for distinct instance ids', () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-owner-'))
    const readyPath = path.join(
      projectDir,
      'dist',
      'extension-js',
      'chromium-owner-ids',
      'ready.json'
    )
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'dev',
        status: 'ready',
        pid: process.ppid,
        runId: 'owner-ids-run',
        instanceId: 'alpha',
        instanceExplicit: true
      })
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    createPlaywrightMetadataWriter({
      packageJsonDir: projectDir,
      browser: 'chromium-owner-ids',
      command: 'dev' as const,
      distPath: path.join(projectDir, 'dist', 'chromium-owner-ids'),
      manifestPath: path.join(projectDir, 'manifest.json'),
      instanceId: 'beta',
      instanceExplicit: true
    })

    const notices = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('owner-ids-run'))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('one session per browser')

    fs.rmSync(projectDir, {recursive: true, force: true})
  })
})

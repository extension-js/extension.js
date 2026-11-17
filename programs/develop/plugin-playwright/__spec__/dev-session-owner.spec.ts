import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {detectLiveDevSessionOwner} from '../index'
import {contractPath, makeWriter} from './helpers/contract'

const makeTempFolder = trackTempFolders()

function writeReadyFixture(overrides: Record<string, unknown> = {}): string {
  const dir = makeTempFolder('extjs-owner-')
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

// A contract another dev session wrote, under projectDir, for browser.
function writeLiveSession(
  projectDir: string,
  browser: string,
  contract: Record<string, unknown>
) {
  const readyPath = contractPath(projectDir, browser)
  fs.mkdirSync(path.dirname(readyPath), {recursive: true})
  fs.writeFileSync(
    readyPath,
    JSON.stringify({
      command: 'dev',
      status: 'ready',
      pid: process.ppid,
      ...contract
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
    const projectDir = makeTempFolder('extjs-owner-')
    const browser = 'chromium-owner-notice'
    writeLiveSession(projectDir, browser, {runId: 'owner-notice-run'})

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const options = {
      browser,
      manifestPath: path.join(projectDir, 'manifest.json')
    }
    makeWriter(projectDir, options)
    makeWriter(projectDir, options)

    const notices = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('owner-notice-run'))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain(
      'Another dev session is already writing dist/chromium-owner-notice'
    )
  })

  it('prints although both sessions asked for distinct instance ids', () => {
    const projectDir = makeTempFolder('extjs-owner-')
    const browser = 'chromium-owner-ids'
    writeLiveSession(projectDir, browser, {
      runId: 'owner-ids-run',
      instanceId: 'alpha',
      instanceExplicit: true
    })

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    makeWriter(projectDir, {
      browser,
      manifestPath: path.join(projectDir, 'manifest.json'),
      instanceId: 'beta',
      instanceExplicit: true
    })

    const notices = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('owner-ids-run'))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('one session per browser')
  })
})

describe("the notice about a live dev session owning another command's target", () => {
  afterEach(() => vi.restoreAllMocks())

  function liveDevProject(browser: string) {
    const projectDir = makeTempFolder('extjs-owner-')
    writeLiveSession(projectDir, browser, {
      runId: 'foreign-owner-run',
      distPath: path.join(projectDir, 'dist', browser)
    })

    return projectDir
  }

  function buildNotices(projectDir: string, browser: string, distPath: string) {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeWriter(projectDir, {
      browser,
      command: 'build',
      distPath,
      manifestPath: path.join(projectDir, 'manifest.json')
    })

    return warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('a live dev session (pid'))
  }

  it('prints when a build writes the folder the dev session serves', () => {
    const browser = 'chromium-shared-dist'
    const projectDir = liveDevProject(browser)

    const notices = buildNotices(
      projectDir,
      browser,
      path.join(projectDir, 'dist', browser)
    )
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('The output dir is shared')
  })

  it('stays quiet when the build writes another folder', () => {
    const browser = 'chromium-own-out-dir'
    const projectDir = liveDevProject(browser)

    const notices = buildNotices(
      projectDir,
      browser,
      path.join(projectDir, 'build', browser)
    )
    expect(notices).toEqual([])
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {
  detectLiveDevSessionOwner,
  forgetSessionRun,
  isDevSessionLiveInThisProcess
} from '../index'
import {
  contractPath,
  makeWriter,
  patchContract,
  readContract,
  stampReadyExtensionLoadRefused
} from './helpers/contract'

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

describe('the live-session check reads pid liveness only', () => {
  afterEach(() => vi.restoreAllMocks())

  // Pins today's behavior. Ledger 1383 D3.
  it('takes a live pid whose start time does not match as the owner', () => {
    const probed: number[] = []
    const readyPath = writeReadyFixture({
      pidStartedAt: '2000-01-01T00:00:00.000Z'
    })

    const owner = detectLiveDevSessionOwner(readyPath, (pid) => {
      probed.push(pid)

      return true
    })

    expect(probed).toEqual([424242])
    expect(owner).toEqual({
      pid: 424242,
      port: null,
      runId: 'f3a9',
      instanceId: 'alpha',
      instanceExplicit: false
    })
  })

  // Pins today's behavior. Ledger 1383 D3.
  it('a build drops its receipt beside a reused pid', () => {
    const projectDir = makeTempFolder('extjs-owner-')
    const readyPath = writeLiveSession(projectDir, 'chromium', {
      runId: 'a-run-whose-pid-was-reused',
      pidStartedAt: '2000-01-01T00:00:00.000Z'
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const build = makeWriter(projectDir, {command: 'build'})
    build.writeStarting()
    build.writeReady()

    const after = readContract(readyPath)
    expect(after.command).toBe('dev')
    expect(after.runId).toBe('a-run-whose-pid-was-reused')
  })

  // Pins today's behavior. Ledger 1383.
  it('reads a malformed contract as no owner, so a build replaces it', () => {
    const projectDir = makeTempFolder('extjs-owner-')
    const readyPath = contractPath(projectDir)
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(readyPath, `{"command":"dev","pid":${process.ppid},`)

    expect(detectLiveDevSessionOwner(readyPath, alive)).toBeNull()

    makeWriter(projectDir, {command: 'build'}).writeReady()

    expect(readContract(readyPath).command).toBe('build')
  })
})

describe('the attach stamp beside another live dev session', () => {
  afterEach(() => vi.restoreAllMocks())

  // A preview with act verbs opened beside a live dev session on one target.
  function previewBesideLiveSession(contract: Record<string, unknown>) {
    const projectDir = makeTempFolder('extjs-owner-')
    const readyPath = writeLiveSession(projectDir, 'chromium', {
      runId: 'a-live-dev-run',
      ...contract
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    return {readyPath, preview: makeWriter(projectDir, {command: 'preview'})}
  }

  // Pins today's behavior. Ledger 1383 D2.
  it("stampExecutorAttached flips the live session's contract to attached and turns its held ready ready", () => {
    const {readyPath, preview} = previewBesideLiveSession({
      status: 'starting',
      compiledAt: '2026-11-01T00:00:00.000Z',
      awaitingExecutorSince: '2026-11-01T00:00:00.000Z'
    })

    preview.stampExecutorAttached()

    const after = readContract(readyPath)
    expect(after.runId).toBe('a-live-dev-run')
    expect(after.pid).toBe(process.ppid)
    expect(after.runtime).toBe('attached')
    expect(typeof after.executorAttachedAt).toBe('string')
    expect(after.status).toBe('ready')
    expect('awaitingExecutorSince' in after).toBe(false)
  })

  // Pins today's behavior. Ledger 1383 D2.
  it("stampExecutorAttached wipes the live session's recorded load refusal", () => {
    const {readyPath, preview} = previewBesideLiveSession({})
    stampReadyExtensionLoadRefused(readyPath, {
      status: 'error',
      code: 'extension_load_refused',
      message: 'Chromium refused to load the extension at /dist/chromium',
      extensionLoadRefusedAt: '2026-11-01T00:00:00.000Z',
      extensionLoadRefusedReason: 'Manifest is not valid JSON.'
    })

    preview.stampExecutorAttached()

    const after = readContract(readyPath)
    expect(after.status).toBe('ready')
    expect('code' in after).toBe(false)
    expect('message' in after).toBe(false)
    expect('extensionLoadRefusedAt' in after).toBe(false)
    expect('extensionLoadRefusedReason' in after).toBe(false)
  })

  // Pins today's behavior. Ledger 1383 D2.
  it("stampExecutorDetached and stampReload leave the live session's contract alone", () => {
    const {readyPath, preview} = previewBesideLiveSession({
      runtime: 'attached',
      executorAttachedAt: '2026-11-01T00:00:00.000Z'
    })
    const before = fs.readFileSync(readyPath, 'utf-8')

    preview.stampExecutorDetached()
    preview.stampReload('full', 'full reload')

    expect(fs.readFileSync(readyPath, 'utf-8')).toBe(before)
  })
})

// A library host runs every dev session in one process. The dev server asks
// this check before it opens a session's writers.
describe('a dev session of this same process', () => {
  afterEach(() => vi.restoreAllMocks())

  // The dev server's writer and its compiler plugin's writer, as a session
  // opens them, with the plugin's first stamp written.
  function openSession(projectDir: string, browser = 'chromium') {
    const devServer = makeWriter(projectDir, {browser})
    const plugin = makeWriter(projectDir, {browser})

    plugin.writeStarting()

    return {devServer, plugin}
  }

  it('owns its target, so the dev server refuses a second session there', () => {
    const projectDir = makeTempFolder('extjs-owner-')
    const isAlive = vi.fn(() => true)
    openSession(projectDir)
    const {runId} = readContract(contractPath(projectDir))

    expect(
      detectLiveDevSessionOwner(contractPath(projectDir), isAlive)
    ).toEqual({
      pid: process.pid,
      port: null,
      runId,
      instanceId: undefined,
      instanceExplicit: false,
      distPath: path.join(projectDir, 'dist', 'chromium')
    })

    // Its own pid is never probed with a signal.
    expect(isAlive).not.toHaveBeenCalled()
    expect(isDevSessionLiveInThisProcess(projectDir, 'chromium')).toBe(true)

    forgetSessionRun(projectDir, 'chromium')
  })

  it.each([
    'error',
    'stopped'
  ])('owns its target until released, with %s stamped', (status) => {
    const projectDir = makeTempFolder('extjs-owner-')
    openSession(projectDir)
    patchContract(contractPath(projectDir), {status})

    expect(detectLiveDevSessionOwner(contractPath(projectDir))).not.toBeNull()

    forgetSessionRun(projectDir, 'chromium')
  })

  it('owns no other browser of the same project', () => {
    const projectDir = makeTempFolder('extjs-owner-')
    openSession(projectDir)
    openSession(projectDir, 'firefox')
    forgetSessionRun(projectDir, 'firefox')

    expect(
      detectLiveDevSessionOwner(contractPath(projectDir, 'firefox'))
    ).toBeNull()

    expect(detectLiveDevSessionOwner(contractPath(projectDir))).not.toBeNull()

    forgetSessionRun(projectDir, 'chromium')
  })

  it('claims nothing while only the dev server writer is open', () => {
    // The first session checks for an owner before its compiler stamps.
    const projectDir = makeTempFolder('extjs-owner-')
    const readyPath = writeLiveSession(projectDir, 'chromium', {
      pid: process.pid,
      runId: 'an-earlier-run-of-this-host'
    })

    makeWriter(projectDir)

    expect(detectLiveDevSessionOwner(readyPath)).toBeNull()
    expect(isDevSessionLiveInThisProcess(projectDir, 'chromium')).toBe(false)

    forgetSessionRun(projectDir, 'chromium')
  })

  it('keeps one run and warns nothing when its compiler restarts', () => {
    const projectDir = makeTempFolder('extjs-owner-')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const {plugin} = openSession(projectDir)
    const runId = readContract(contractPath(projectDir)).runId

    // A restart builds a new compiler, and its plugin opens a writer again.
    const next = makeWriter(projectDir)

    next.writeStarting()
    plugin.writeStarting()

    expect(readContract(contractPath(projectDir)).runId).toBe(runId)
    expect(warn).not.toHaveBeenCalled()

    forgetSessionRun(projectDir, 'chromium')
  })

  it('is no owner once released, and the next session draws a new run', () => {
    const projectDir = makeTempFolder('extjs-owner-')
    openSession(projectDir)
    const runId = readContract(contractPath(projectDir)).runId

    forgetSessionRun(projectDir, 'chromium')

    expect(detectLiveDevSessionOwner(contractPath(projectDir))).toBeNull()
    expect(isDevSessionLiveInThisProcess(projectDir, 'chromium')).toBe(false)

    openSession(projectDir)
    expect(readContract(contractPath(projectDir)).runId).not.toBe(runId)

    forgetSessionRun(projectDir, 'chromium')
  })
})

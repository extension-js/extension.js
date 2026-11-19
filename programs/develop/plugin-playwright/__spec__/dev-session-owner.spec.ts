import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import {detectLiveDevSessionOwner, forgetSessionRun} from '../index'
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
      .filter((line) => line.includes('A live dev session (PID'))
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
    expect(notices[0]).toContain('The output folder is shared')
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

describe('the live-session check dates the pid it finds alive', () => {
  afterEach(() => vi.restoreAllMocks())

  const stamped = '2026-11-01T10:00:00.000Z'
  const stampedMs = Date.parse(stamped)

  // A pid is handed to another process once its owner exits, so a live pid
  // that started at another time is not the session that wrote the contract.
  it('takes no owner from a live pid whose start time does not match', () => {
    const readyPath = writeReadyFixture({pidStartedAt: stamped})

    expect(
      detectLiveDevSessionOwner(readyPath, alive, () => stampedMs + 60_000)
    ).toBeNull()
  })

  it('keeps the owner when the start time matches within tolerance', () => {
    const readyPath = writeReadyFixture({pidStartedAt: stamped})

    expect(
      detectLiveDevSessionOwner(readyPath, alive, () => stampedMs + 900)
    ).toMatchObject({pid: 424242, runId: 'f3a9'})
  })

  it('keeps the owner when the process table cannot date the pid', () => {
    const readyPath = writeReadyFixture({pidStartedAt: stamped})

    expect(
      detectLiveDevSessionOwner(readyPath, alive, () => null)
    ).toMatchObject({pid: 424242})
  })

  it('does not date a pid the contract carries no start time for', () => {
    const probed: number[] = []
    const readyPath = writeReadyFixture()

    const owner = detectLiveDevSessionOwner(readyPath, alive, (pid) => {
      probed.push(pid)

      return 0
    })

    expect(owner).toMatchObject({pid: 424242})
    expect(probed).toEqual([])
  })

  it('a build writes its receipt beside a reused pid', () => {
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
    expect(after.command).toBe('build')
    expect(after.runId).not.toBe('a-run-whose-pid-was-reused')
  })

  // Pins current behavior: a half-written contract is replaced, not kept.
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

  // The attach stamp checks ownership like the detach and reload stamps.
  it("stampExecutorAttached leaves the live session's held ready alone", () => {
    const {readyPath, preview} = previewBesideLiveSession({
      status: 'starting',
      compiledAt: '2026-11-01T00:00:00.000Z',
      awaitingExecutorSince: '2026-11-01T00:00:00.000Z'
    })
    const before = fs.readFileSync(readyPath, 'utf-8')

    preview.stampExecutorAttached()

    expect(fs.readFileSync(readyPath, 'utf-8')).toBe(before)
  })

  it("stampExecutorAttached leaves the live session's load refusal alone", () => {
    const {readyPath, preview} = previewBesideLiveSession({})
    stampReadyExtensionLoadRefused(readyPath, {
      status: 'error',
      code: 'extension_load_refused',
      message: 'Chromium refused to load the extension at /dist/chromium',
      extensionLoadRefusedAt: '2026-11-01T00:00:00.000Z',
      extensionLoadRefusedReason: 'Manifest is not valid JSON.'
    })

    const before = fs.readFileSync(readyPath, 'utf-8')

    preview.stampExecutorAttached()

    expect(fs.readFileSync(readyPath, 'utf-8')).toBe(before)
  })

  it('stampExecutorAttached leaves a record of another run in this process alone', () => {
    const projectDir = makeTempFolder('extjs-owner-')
    const writer = makeWriter(projectDir)
    writer.writeReady()
    patchContract(writer.readyPath, {runId: 'a-run-that-already-ended'})
    const before = fs.readFileSync(writer.readyPath, 'utf-8')

    writer.stampExecutorAttached()

    expect(fs.readFileSync(writer.readyPath, 'utf-8')).toBe(before)
  })

  // The two stamps that do check ownership, for contrast with the rows above.
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

// The engine refuses a second session of one process on a target before its
// writers open, so the writers of one session never read each other as owner.
describe('a dev session of this same process', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps one run and warns nothing when its compiler restarts', () => {
    const projectDir = makeTempFolder('extjs-owner-')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plugin = makeWriter(projectDir)

    makeWriter(projectDir)
    plugin.writeStarting()

    const runId = readContract(contractPath(projectDir)).runId

    // A restart builds a new compiler, and its plugin opens a writer again.
    const next = makeWriter(projectDir)

    next.writeStarting()
    plugin.writeStarting()

    expect(readContract(contractPath(projectDir)).runId).toBe(runId)
    expect(detectLiveDevSessionOwner(contractPath(projectDir))).toBeNull()
    expect(warn).not.toHaveBeenCalled()

    forgetSessionRun(projectDir, 'chromium')
  })
})

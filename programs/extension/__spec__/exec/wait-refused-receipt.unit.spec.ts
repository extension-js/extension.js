import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  describeWaitError,
  READY_CONTRACT_FRESHNESS_MS,
  runWaitMode,
  standingLoadRefusal
} from '../../commands/dev-wait'

const SENTENCE =
  'Cannot install extension because it uses an unsupported manifest version.'
const DEAD_PID = 999999999

describe('--wait against a run the browser refused', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  // A refusal well past the freshness window, with the manifest the browser
  // read written before it, the way a finished run leaves the folder.
  function refusedProject(
    command: 'start' | 'dev',
    contract: Record<string, unknown> = {}
  ) {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-wait-refused-'))
    tempDirs.push(projectDir)

    const distPath = join(projectDir, 'dist', 'chromium')
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    const manifestPath = join(projectDir, 'manifest.json')
    const refusedAt = Date.now() - READY_CONTRACT_FRESHNESS_MS * 10
    const before = new Date(refusedAt - 5000)

    mkdirSync(distPath, {recursive: true})
    mkdirSync(readyDir, {recursive: true})

    for (const file of [manifestPath, join(distPath, 'manifest.json')]) {
      writeFileSync(file, '{"manifest_version":2,"name":"x","version":"1"}')
      utimesSync(file, before, before)
    }

    const stamp = new Date(refusedAt).toISOString()

    writeFileSync(
      join(readyDir, 'ready.json'),
      JSON.stringify({
        command,
        browser: 'chromium',
        status: 'error',
        code: 'extension_load_refused',
        message: `Chromium refused to load the extension at ${distPath}: ${SENTENCE}`,
        extensionLoadRefusedAt: stamp,
        extensionLoadRefusedReason: SENTENCE,
        distPath,
        manifestPath,
        pid: DEAD_PID,
        startedAt: stamp,
        ts: stamp,
        compiledAt: stamp,
        ...contract
      })
    )

    return {projectDir, distPath, manifestPath}
  }

  async function wait(command: 'start' | 'dev', projectDir: string) {
    const started = Date.now()
    const error = await runWaitMode({
      command,
      pathOrRemoteUrl: projectDir,
      browsers: ['chromium'],
      waitTimeout: 1500
    }).then(
      () => null,
      (reason: unknown) => reason
    )

    return {failure: describeWaitError(error), elapsedMs: Date.now() - started}
  }

  it('answers a stale refused start receipt at once, with the refusal code', async () => {
    const {projectDir, distPath} = refusedProject('start')
    const {failure, elapsedMs} = await wait('start', projectDir)

    expect(failure).toEqual({
      code: 'E_EXTENSION_LOAD_REFUSED',
      status: 'load-refused',
      message: `Chromium refused to load the extension at ${distPath}: ${SENTENCE}`,
      hint: 'Fix what the browser names, then run the command again.'
    })

    expect(elapsedMs).toBeLessThan(1000)
  })

  it('answers a stopped dev contract that kept its refusal', async () => {
    const {projectDir} = refusedProject('dev', {
      status: 'stopped',
      code: 'shutdown',
      message: 'the dev session ended (watch closed)'
    })
    const {failure, elapsedMs} = await wait('dev', projectDir)

    expect(failure.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(failure.status).toBe('load-refused')
    expect(failure.message).toBe(
      `The browser refused to load the extension: ${SENTENCE}`
    )

    expect(elapsedMs).toBeLessThan(1000)
  })

  // An edit after the refusal means the next run may load, so the old
  // verdict is no answer for the run the caller is waiting on.
  it.each([
    'manifestPath',
    'distPath'
  ] as const)('keeps waiting once %s changed after the refusal', async (which) => {
    const project = refusedProject('start')
    const edited =
      which === 'manifestPath'
        ? project.manifestPath
        : join(project.distPath, 'manifest.json')

    utimesSync(edited, new Date(), new Date())

    const {failure} = await wait('start', project.projectDir)

    expect(failure.code).toBe('E_READY_TIMEOUT')
  })

  it.each([
    ['a refused start receipt', 'start', {}],
    [
      'a stopped dev contract',
      'dev',
      {status: 'stopped', code: 'shutdown', message: 'the dev session ended'}
    ]
  ] as const)('adds the recorded cause to the answer for %s', async (_label, command, contract) => {
    const cause = 'Firefox does not load a manifest_version above 3.'
    const {projectDir} = refusedProject(command, {
      ...contract,
      extensionLoadRefusedCause: cause
    })
    const {failure} = await wait(command, projectDir)

    expect(failure.code).toBe('E_EXTENSION_LOAD_REFUSED')
    expect(failure.message.endsWith(`${SENTENCE.slice(0, -1)}. ${cause}`)).toBe(
      true
    )
  })

  it('keeps waiting on a dead run that recorded no refusal', async () => {
    const {projectDir} = refusedProject('start', {
      code: 'browser_launch_failed',
      extensionLoadRefusedAt: undefined,
      extensionLoadRefusedReason: undefined
    })

    expect((await wait('start', projectDir)).failure.code).toBe(
      'E_READY_TIMEOUT'
    )
  })

  it('reads no standing refusal off a contract with no manifest to compare', () => {
    expect(
      standingLoadRefusal({
        code: 'extension_load_refused',
        extensionLoadRefusedAt: new Date().toISOString(),
        message: 'refused'
      })
    ).toBeUndefined()
  })
})

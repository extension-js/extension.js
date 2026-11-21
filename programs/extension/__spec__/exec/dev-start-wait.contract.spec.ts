import {mkdirSync, realpathSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'
import {renameSyncWithRetry} from '../../../develop/lib/rename-with-retry'
import {type CliRun, everyLineAsFrame, runCli} from '../helpers/run-cli'
import {trackTempFolders} from '../helpers/temp-folders'

type Verb = 'dev' | 'start'

// A CI runner spends more of the budget spawning node and loading cli.cjs,
// so each budget carries a modest margin there and nothing more.
const WAIT_BUDGET_MS = process.env.CI ? 10_000 : 5000
const CLI_TIMEOUT_MS = process.env.CI ? 30_000 : 15_000
// The first contract state has to survive at least one 250ms poll before the
// next write lands, or a slow start would skip the transition under test.
const CONTRACT_WRITE_MS = process.env.CI ? 750 : 500
const FIRST_CONTRACT_WRITE_MS = Math.round(CONTRACT_WRITE_MS / 2)
// A case that wants the timeout gains nothing from a longer one: the
// waiter looks once, sleeps one 250ms poll and gives up.
const TIMEOUT_BUDGET_MS = 200
const DEAD_PID = 999999999

const TIMEOUT_HINT =
  'Raise --wait-timeout, or read the server output for what kept it from reporting ready.'
const ERROR_STATUS_HINT =
  'Read the server output for the failure behind the ready contract.'
const LOAD_REFUSED_HINT =
  'Fix what the browser names, then run the command again.'
const PROFILE_LOCKED_HINT =
  'Close the browser that has this profile open, or pass --profile <path> to use another one.'
const REMOTE_MESSAGE =
  '--wait requires a local project path (remote URLs are not supported)'
const REMOTE_HINT =
  'Pass a local project path to --wait. Remote URLs are not supported.'

const makeTemp = trackTempFolders()

function createProject() {
  const projectDir = realpathSync(makeTemp('extjs-wait-'))
  const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
  mkdirSync(readyDir, {recursive: true})

  return {
    projectDir,
    distPath: join(projectDir, 'dist'),
    readyPath: join(readyDir, 'ready.json')
  }
}

// The waiter polls this file while the test rewrites it, so a plain write can
// be read truncated. Rename is atomic, which is what the product's writer does.
function writeContract(readyPath: string, contract: Record<string, unknown>) {
  const tmpPath = `${readyPath}.tmp-${process.pid}`

  writeFileSync(tmpPath, JSON.stringify(contract))
  renameSyncWithRetry(tmpPath, readyPath)
}

// The waiter prints nothing while it polls, so the producer side of each
// case is a timer from the spawn and not a wait on something observable.
function writeContractLater(
  readyPath: string,
  contract: Record<string, unknown>,
  afterMs = CONTRACT_WRITE_MS
) {
  setTimeout(() => writeContract(readyPath, contract), afterMs)
}

function wait(verb: Verb, target: string, ...flags: string[]) {
  return runCli([verb, target, '--wait', '--browser=chromium', ...flags], {
    timeoutMs: CLI_TIMEOUT_MS
  })
}

const asJson = ['--output', 'json']
const withBudget = `--wait-timeout=${WAIT_BUDGET_MS}`
const withShortBudget = `--wait-timeout=${TIMEOUT_BUDGET_MS}`

// Exit 0 alone would also be what a waiter that never read the file gives.
function expectReadyEnvelope(
  run: CliRun,
  verb: Verb,
  contract: Record<string, unknown>,
  stderr = ''
) {
  expect(run.status, run.stderr).toBe(0)
  expect(run.stderr).toBe(stderr)
  expect(everyLineAsFrame(run.stdout)).toEqual([
    {
      schema: 1,
      ok: true,
      command: verb,
      status: 'ready',
      value: {
        mode: 'wait',
        command: verb,
        browsers: ['chromium'],
        results: [{...contract, browser: 'chromium'}]
      },
      error: null,
      warnings: []
    }
  ])
}

describe.each(['dev', 'start'] as const)('%s --wait contract', (verb) => {
  it('waits from starting to ready and answers one ready envelope', async () => {
    const {projectDir, distPath, readyPath} = createProject()
    const ready = {command: verb, status: 'ready', distPath, pid: process.pid}
    const run = wait(verb, projectDir, withBudget, ...asJson)

    writeContractLater(
      readyPath,
      {...ready, status: 'starting'},
      FIRST_CONTRACT_WRITE_MS
    )

    writeContractLater(readyPath, ready)

    expectReadyEnvelope(await run, verb, ready)
  })

  it('carries the contract verbatim with --wait-format=json', async () => {
    const {projectDir, distPath, readyPath} = createProject()
    const ready = {
      command: verb,
      status: 'ready',
      browser: 'chromium',
      distPath,
      runId: 'run-123',
      startedAt: new Date().toISOString(),
      pid: process.pid
    }
    const run = wait(verb, projectDir, withBudget, '--wait-format=json')

    writeContractLater(readyPath, ready)

    // The old spelling of the flag still answers, and says what replaced it.
    expectReadyEnvelope(
      await run,
      verb,
      ready,
      '⏵⏵⏵ Warning: --wait-format is deprecated and maps to --output.\n' +
        'Pass --output <pretty|json> instead.\n'
    )
  })

  it('says nothing in text mode when the session is ready', async () => {
    const {projectDir, distPath, readyPath} = createProject()

    writeContract(readyPath, {
      command: verb,
      status: 'ready',
      browser: 'chromium',
      distPath,
      pid: process.pid
    })

    const run = await wait(verb, projectDir, withBudget)

    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr
    }).toEqual({status: 0, stdout: '', stderr: ''})
  })

  // A compile failure in the user's own extension must stay distinguishable
  // from a fault in the CLI, which E_INTERNAL would have collapsed it into.
  it('reports a ready contract error status as E_READY_ERROR_STATUS', async () => {
    const {projectDir, readyPath} = createProject()
    const now = new Date().toISOString()
    const message =
      'Module not found: Cannot resolve ./missing in background.js'
    const run = wait(verb, projectDir, withBudget, ...asJson)

    writeContractLater(readyPath, {
      schemaVersion: 2,
      command: verb,
      status: 'error',
      browser: 'chromium',
      message,
      errors: [message],
      pid: process.pid,
      ts: now,
      startedAt: now,
      compiledAt: now
    })

    const result = await run

    expect(result.status).toBe(1)
    expect(everyLineAsFrame(result.stdout)).toEqual([
      {
        schema: 1,
        ok: false,
        command: verb,
        status: 'failed',
        value: null,
        error: {code: 'E_READY_ERROR_STATUS', message},
        warnings: [],
        hint: ERROR_STATUS_HINT
      }
    ])

    // One error line and its remedy, whole: a stack would be a third line.
    expect(result.stderr).toBe(`⏵⏵⏵ Error: ${message}.\n${ERROR_STATUS_HINT}\n`)
  })

  it('renders a timeout as one error line and a remedy, never a stack', async () => {
    const {projectDir, readyPath} = createProject()
    const run = await wait(verb, projectDir, withShortBudget)

    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe(
      `⏵⏵⏵ Error: Timed out waiting for ready contract at ${readyPath} ` +
        `(${TIMEOUT_BUDGET_MS} ms).\n${TIMEOUT_HINT}\n`
    )
  })

  it('keeps stderr free of stacks while stdout carries one timeout envelope', async () => {
    const {projectDir, readyPath} = createProject()
    const run = await wait(verb, projectDir, withShortBudget, ...asJson)
    const message =
      `Timed out waiting for ready contract at ${readyPath} ` +
      `(${TIMEOUT_BUDGET_MS} ms)`

    expect(run.status).toBe(1)
    expect(everyLineAsFrame(run.stdout)).toEqual([
      {
        schema: 1,
        ok: false,
        command: verb,
        status: 'timeout',
        value: null,
        error: {code: 'E_READY_TIMEOUT', message},
        warnings: [],
        hint: TIMEOUT_HINT
      }
    ])

    expect(run.stderr).toBe(`⏵⏵⏵ Error: ${message}.\n${TIMEOUT_HINT}\n`)
  })

  it('renders a remote url refusal as one error line, never a stack', async () => {
    const run = await wait(verb, 'https://example.com', withShortBudget)

    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    expect(run.stderr).toBe(`⏵⏵⏵ Error: ${REMOTE_MESSAGE}.\n${REMOTE_HINT}\n`)
  })

  it('frames a remote url refusal as E_REMOTE_URL_UNSUPPORTED', async () => {
    const run = await wait(
      verb,
      'https://example.com',
      withShortBudget,
      '--output=json'
    )

    expect(run.status).toBe(1)
    expect(everyLineAsFrame(run.stdout)).toEqual([
      {
        schema: 1,
        ok: false,
        command: verb,
        status: 'usage',
        value: null,
        error: {code: 'E_REMOTE_URL_UNSUPPORTED', message: REMOTE_MESSAGE},
        warnings: [],
        hint: REMOTE_HINT
      }
    ])

    expect(run.stderr).toBe(`⏵⏵⏵ Error: ${REMOTE_MESSAGE}.\n${REMOTE_HINT}\n`)
  })
})

// What makes a contract stale differs by verb: a dev session is its
// process, while a start run may end before anyone waits on it.
describe('dev --wait contract staleness', () => {
  it('ignores stale ready.json from dead producer pid', async () => {
    const {projectDir, distPath, readyPath} = createProject()
    const ready = {
      command: 'dev',
      status: 'ready',
      browser: 'chromium',
      distPath,
      pid: process.pid
    }

    writeContract(readyPath, {...ready, pid: DEAD_PID})

    const run = wait('dev', projectDir, withBudget, ...asJson)

    writeContractLater(readyPath, ready)

    expectReadyEnvelope(await run, 'dev', ready)
  })
})

describe('start --wait contract staleness', () => {
  it('ignores ready payload from dev command and waits for start', async () => {
    const {projectDir, distPath, readyPath} = createProject()
    const ready = {
      command: 'start',
      status: 'ready',
      distPath,
      pid: process.pid
    }

    writeContract(readyPath, {...ready, command: 'dev'})

    const run = wait('start', projectDir, withBudget, ...asJson)

    writeContractLater(readyPath, ready)

    expectReadyEnvelope(await run, 'start', ready)
  })

  it('accepts fresh start contract even when producer pid is no longer alive', async () => {
    const {projectDir, distPath, readyPath} = createProject()
    const ready = {
      command: 'start',
      status: 'ready',
      distPath,
      ts: new Date().toISOString(),
      pid: DEAD_PID
    }
    const run = wait('start', projectDir, withBudget, ...asJson)

    writeContractLater(readyPath, ready)

    expectReadyEnvelope(await run, 'start', ready)
  })
})

// Each failure id a session writes to ready.json reaches a --wait reader as
// its own code. The contract is there before the waiter starts, so no timer.
describe('dev --wait on a ready.json that names a failure', () => {
  it.each([
    ['browser_exited', 'E_BROWSER_EXITED', 'failed', ERROR_STATUS_HINT],
    ['compile_failed', 'E_COMPILE_FATAL', 'failed', ERROR_STATUS_HINT],
    [
      'dev_server_start_failed',
      'E_DEV_SERVER_START',
      'failed',
      ERROR_STATUS_HINT
    ],
    [
      'extension_load_refused',
      'E_EXTENSION_LOAD_REFUSED',
      'load-refused',
      LOAD_REFUSED_HINT
    ],
    [
      'preview_manifest_missing',
      'E_PREVIEW_NO_DIST',
      'failed',
      ERROR_STATUS_HINT
    ],
    ['profile_locked', 'E_PROFILE_LOCKED', 'failed', PROFILE_LOCKED_HINT],
    ['shutdown', 'E_SESSION_STOPPED', 'failed', ERROR_STATUS_HINT]
  ])('%s answers %s as %s', async (readyCode, code, status, hint) => {
    const {projectDir, readyPath} = createProject()
    const message = `the session stopped on ${readyCode}`

    writeContract(readyPath, {
      command: 'dev',
      status: 'error',
      code: readyCode,
      message,
      pid: process.pid
    })

    const run = await wait('dev', projectDir, withBudget, ...asJson)

    expect(run.status).toBe(1)
    expect(everyLineAsFrame(run.stdout)).toEqual([
      {
        schema: 1,
        ok: false,
        command: 'dev',
        status,
        value: null,
        error: {code, message},
        warnings: [],
        hint
      }
    ])

    expect(run.stderr).toBe(`⏵⏵⏵ Error: ${message}.\n${hint}\n`)
  })
})

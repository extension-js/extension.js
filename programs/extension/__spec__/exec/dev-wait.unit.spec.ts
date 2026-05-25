import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  runDevWaitMode,
  isFreshContractPayload,
  READY_CONTRACT_FRESHNESS_MS
} from '../../commands/dev-wait'

describe('runDevWaitMode', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, {recursive: true, force: true})
    }
    tempDirs.length = 0
  })

  function createProject() {
    const projectDir = mkdtempSync(join(tmpdir(), 'extjs-dev-wait-unit-'))
    tempDirs.push(projectDir)
    return projectDir
  }

  it('resolves when ready contract becomes ready', async () => {
    const projectDir = createProject()
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    mkdirSync(readyDir, {recursive: true})

    setTimeout(() => {
      writeFileSync(
        join(readyDir, 'ready.json'),
        JSON.stringify({
          command: 'dev',
          status: 'ready',
          browser: 'chromium',
          distPath: join(projectDir, 'dist'),
          pid: process.pid
        })
      )
    }, 100)

    const result = await runDevWaitMode({
      pathOrRemoteUrl: projectDir,
      browsers: ['chromium'],
      waitTimeout: 5000
    })

    expect(result.browsers).toEqual(['chromium'])
    expect(result.results[0]?.status).toBe('ready')
  })

  it('throws when contract reports error', async () => {
    const projectDir = createProject()
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    mkdirSync(readyDir, {recursive: true})

    setTimeout(() => {
      writeFileSync(
        join(readyDir, 'ready.json'),
        JSON.stringify({
          command: 'dev',
          status: 'error',
          message: 'Compilation failed',
          pid: process.pid
        })
      )
    }, 100)

    await expect(
      runDevWaitMode({
        pathOrRemoteUrl: projectDir,
        browsers: ['chromium'],
        waitTimeout: 5000
      })
    ).rejects.toThrow('Compilation failed')
  })

  it('keeps waiting when stale pid is dead', async () => {
    const projectDir = createProject()
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    const readyPath = join(readyDir, 'ready.json')
    mkdirSync(readyDir, {recursive: true})

    writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'dev',
        status: 'ready',
        browser: 'chromium',
        distPath: join(projectDir, 'dist'),
        pid: 999999999
      })
    )

    setTimeout(() => {
      writeFileSync(
        readyPath,
        JSON.stringify({
          command: 'dev',
          status: 'ready',
          browser: 'chromium',
          distPath: join(projectDir, 'dist'),
          pid: process.pid
        })
      )
    }, 350)

    const result = await runDevWaitMode({
      pathOrRemoteUrl: projectDir,
      browsers: ['chromium'],
      waitTimeout: 5000
    })

    expect(result.results[0]?.status).toBe('ready')
  })

  it('keeps waiting when command does not match expected', async () => {
    const projectDir = createProject()
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    const readyPath = join(readyDir, 'ready.json')
    mkdirSync(readyDir, {recursive: true})

    writeFileSync(
      readyPath,
      JSON.stringify({
        command: 'start',
        status: 'ready',
        browser: 'chromium',
        distPath: join(projectDir, 'dist'),
        pid: process.pid
      })
    )

    setTimeout(() => {
      writeFileSync(
        readyPath,
        JSON.stringify({
          command: 'dev',
          status: 'ready',
          browser: 'chromium',
          distPath: join(projectDir, 'dist'),
          pid: process.pid
        })
      )
    }, 350)

    const result = await runDevWaitMode({
      pathOrRemoteUrl: projectDir,
      browsers: ['chromium'],
      waitTimeout: 5000
    })

    expect(result.results[0]?.status).toBe('ready')
  })

  it('supports json format and timeout normalization', async () => {
    const projectDir = createProject()
    const readyDir = join(projectDir, 'dist', 'extension-js', 'chromium')
    mkdirSync(readyDir, {recursive: true})

    writeFileSync(
      join(readyDir, 'ready.json'),
      JSON.stringify({
        command: 'dev',
        status: 'ready',
        browser: 'chromium',
        distPath: join(projectDir, 'dist'),
        runId: 'run-123',
        startedAt: new Date().toISOString(),
        pid: process.pid
      })
    )

    const result = await runDevWaitMode({
      pathOrRemoteUrl: projectDir,
      browsers: ['chromium'],
      waitTimeout: 'invalid',
      waitFormat: 'json'
    })

    expect(result.format).toBe('json')
    expect(result.timeoutMs).toBe(60000)
  })

  it('treats freshness as a fixed window, independent of --wait-timeout', () => {
    const justNow = new Date().toISOString()
    const wellPastWindow = new Date(
      Date.now() - (READY_CONTRACT_FRESHNESS_MS + 30_000)
    ).toISOString()

    // A recent contract is fresh.
    expect(isFreshContractPayload({ts: justNow})).toBe(true)

    // A contract older than the fixed window is stale — even though a user
    // could have passed an arbitrarily large --wait-timeout. Freshness no
    // longer scales with the timeout, so this can never be widened into a
    // false positive by a patient wait.
    expect(isFreshContractPayload({ts: wellPastWindow})).toBe(false)
  })

  it('rejects remote URLs', async () => {
    await expect(
      runDevWaitMode({
        pathOrRemoteUrl: 'https://example.com/ext.zip',
        browsers: ['chromium'],
        waitTimeout: 5000
      })
    ).rejects.toThrow('requires a local project path')
  })
})

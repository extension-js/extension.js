import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {everyLineAsFrame, runCli} from '../helpers/run-cli'

interface Check {
  check: string
  status: string
  detail: string
}

interface Frame {
  ok: boolean
  command: string
  status: string
  value: Check[] | null
  error: {code: string; message: string} | null
  hint?: string
}

// A check reports pass only for something it read. A project that is not
// there is refused as every command refuses it, before any check runs.
describe('doctor on a project it cannot read', () => {
  const leftovers: string[] = []

  afterEach(() => {
    for (const dir of leftovers.splice(0)) {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  function workDir(): string {
    const work = mkdtempSync(join(tmpdir(), 'extjs-doctor-unread-'))
    leftovers.push(work)

    return work
  }

  it('refuses a folder that does not exist with the code build gives, in json and in text', async () => {
    const missing = join(workDir(), 'no-such-project')
    const [doctor, build] = await Promise.all(
      (['doctor', 'build'] as const).map((command) =>
        runCli([command, missing, '--output', 'json'], {timeoutMs: 60_000})
      )
    )

    const [frame] = everyLineAsFrame<Frame>(doctor.stdout)
    const [reference] = everyLineAsFrame<Frame>(build.stdout)

    expect(everyLineAsFrame<Frame>(doctor.stdout)).toHaveLength(1)
    expect(doctor.status).toBe(1)
    expect(frame).toEqual({
      ...reference,
      command: 'doctor',
      hint: reference.hint?.replaceAll('extension build', 'extension doctor')
    })

    expect(frame.error?.code).toBe('E_PROJECT_NOT_FOUND')
    expect(frame.value).toBeNull()

    const text = await runCli(['doctor', missing], {
      timeoutMs: 60_000,
      env: {NO_COLOR: '1'}
    })

    expect(text.status).toBe(1)
    expect(text.stdout).toBe('')
    expect(text.stderr).toContain(`No project folder at ${missing}`)
    expect(text.stderr).not.toContain('peer-rspack')
  }, 90_000)

  it('skips the dependency check for a project with no package.json, and never passes it', async () => {
    const projectDir = join(workDir(), 'project')
    mkdirSync(projectDir)
    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'Bare', version: '1.0.0'})
    )

    const run = await runCli(['doctor', projectDir, '--output', 'json'], {
      timeoutMs: 60_000
    })

    const [frame] = everyLineAsFrame<Frame>(run.stdout)
    const peers = frame.value?.find((check) => check.check === 'peer-rspack')

    expect(peers).toEqual({
      check: 'peer-rspack',
      status: 'skip',
      detail: `skipped: no package.json at ${projectDir}, so there are no dependencies to read`
    })

    // No session ran here, which is still what the report is about.
    expect(frame.error?.code).toBe('E_SESSION_NOT_FOUND')
    expect(frame.value?.filter((check) => check.status === 'pass')).toEqual([])
  }, 90_000)
})

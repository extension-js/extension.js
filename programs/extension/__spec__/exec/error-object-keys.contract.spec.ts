import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {everyLineAsFrame, runCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  error: Record<string, unknown> | null
}

// One failure reads the same whichever command meets it: a reader written
// against the error object of one command works on the next.
// The rule: a usage refusal a command raises carries no name, a thrown
// failure names its error, and a parser refusal names CliError.
describe('the error object of one failure across the commands that can raise it', () => {
  let work: string
  let projectDir: string

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'extjs-error-keys-'))
    projectDir = join(work, 'project')
    mkdirSync(projectDir)
    mkdirSync(join(work, 'empty'))
    writeFileSync(
      join(projectDir, 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'Keys', version: '1.0.0'})
    )

    mkdirSync(join(work, 'throwing-config'))
    writeFileSync(
      join(work, 'throwing-config', 'manifest.json'),
      JSON.stringify({manifest_version: 3, name: 'Keys', version: '1.0.0'})
    )

    writeFileSync(
      join(work, 'throwing-config', 'extension.config.js'),
      "throw new Error('config boom')\n"
    )
  })

  afterAll(() => {
    rmSync(work, {recursive: true, force: true})
  })

  async function failureOf(args: string[]): Promise<Frame> {
    const run = await runCli([...args, '--output', 'json'], {
      timeoutMs: 60_000,
      // No browser of this machine is found, so the launch fails by itself.
      env: {EXTENSION_INTERNAL_SKIP_SYSTEM_BROWSERS: '1'}
    })

    const frames = everyLineAsFrame<Frame>(run.stdout)
    const frame = frames.at(-1)

    // dev frames its startup first and ends on the refusal.
    expect(
      frames.filter((each) => !each.ok),
      run.stderr
    ).toHaveLength(1)

    expect(frame?.ok).toBe(false)
    expect(run.status).toBe(1)

    return frame as Frame
  }

  const KINDS: Array<{
    kind: string
    code: string
    keys: string[]
    runs: () => string[][]
  }> = [
    {
      kind: 'a browser that is not installed',
      code: 'E_BROWSER_NOT_FOUND',
      keys: ['code', 'message', 'name'],
      runs: () => [
        ['start', projectDir, '--browser', 'chromium'],
        ['preview', projectDir, '--browser', 'chromium']
      ]
    },
    {
      // The project's own file failed, which build, start and dev frame from
      // the build step. preview has no build step and frames it the same.
      kind: 'a config file that throws',
      code: 'E_CONFIG_LOAD',
      keys: ['code', 'message'],
      runs: () => [
        ['build', join(work, 'throwing-config')],
        ...['dev', 'start', 'preview'].map((command) => [
          command,
          join(work, 'throwing-config'),
          '--no-browser'
        ])
      ]
    },
    {
      kind: 'a project folder that does not exist',
      code: 'E_PROJECT_NOT_FOUND',
      keys: ['code', 'message'],
      runs: () =>
        ['dev', 'build', 'start', 'preview', 'doctor'].map((command) => [
          command,
          join(work, 'no-such-project')
        ])
    },
    {
      kind: 'a pinned browser binary that does not exist',
      code: 'E_BROWSER_BINARY_INVALID',
      keys: ['code', 'message'],
      runs: () =>
        ['dev', 'start', 'preview'].map((command) => [
          command,
          projectDir,
          '--browser',
          'chromium',
          '--chromium-binary',
          join(work, 'no-such-browser')
        ])
    },
    {
      kind: 'a folder with no manifest',
      code: 'E_MANIFEST_NOT_FOUND',
      keys: ['code', 'message'],
      runs: () =>
        ['dev', 'build', 'start', 'preview'].map((command) => [
          command,
          join(work, 'empty')
        ])
    },
    {
      kind: 'an option the command does not have',
      code: 'E_FLAG_NOT_SUPPORTED_HERE',
      keys: ['code', 'message', 'name', 'refs'],
      runs: () =>
        ['dev', 'build', 'start', 'preview', 'doctor', 'install', 'create'].map(
          (command) => [command, projectDir, '--no-such-option']
        )
    },
    {
      kind: 'a browser name no command knows',
      code: 'E_UNSUPPORTED_BROWSER',
      keys: ['code', 'message'],
      runs: () => [
        ...['dev', 'build', 'start', 'preview', 'doctor'].map((command) => [
          command,
          projectDir,
          '--browser',
          'netscape'
        ]),
        ['install', 'netscape']
      ]
    }
  ]

  it.each(KINDS)('$kind: $code with the keys $keys', async ({
    code,
    keys,
    runs
  }) => {
    const frames = await Promise.all(runs().map(failureOf))

    for (const frame of frames) {
      expect(
        {command: frame.command, code: frame.error?.code},
        JSON.stringify(frame)
      ).toEqual({command: frame.command, code})

      expect(
        {command: frame.command, keys: Object.keys(frame.error ?? {}).sort()},
        JSON.stringify(frame)
      ).toEqual({command: frame.command, keys})
    }
  }, 180_000)
})

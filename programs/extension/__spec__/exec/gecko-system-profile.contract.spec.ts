import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {plantBrowserStandIn} from '../helpers/browser-stand-in'
import {framesIn, runCli as spawnCli} from '../helpers/run-cli'

interface Frame {
  ok: boolean
  command: string
  status: string
  error: {code: string; message: string} | null
}

type Command = 'dev' | 'start' | 'preview'
type Source = 'flag' | 'config' | 'env'

const NAMED: Record<Source, string> = {
  flag: '--profile=false',
  config: 'profile: false in extension.config.js',
  env: 'EXTENSION_USE_SYSTEM_PROFILE=true'
}

// No compile changes a refused profile mode, so dev ends the session itself
// as start and preview do, and every run here is read to its own exit.
async function runCli(args: string[], extraEnv: Record<string, string>) {
  const run = await spawnCli(args, {timeoutMs: 100_000, env: extraEnv})

  return {code: run.status, stdout: run.output}
}

function failureFrames(stdout: string): Frame[] {
  return framesIn<Frame>(stdout).filter((frame) => !frame.ok)
}

// A Gecko browser on its own profile has remote debugging off, so the CLI
// must refuse before spawning it. The stand-in records any spawn it gets.
function geckoSystemProfileSpecs(command: Command) {
  let work = ''

  const project = (source: Source) => join(work, `project-${source}`)
  // One stand-in per case, so a spawn in one case never fails another.
  const standIns: Record<string, string> = {}
  const standIn = (key: string) => standIns[key]
  const spawnedLog = (key: string) => join(work, `spawned-${key}.log`)

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), `extjs-gecko-system-${command}-`))

    for (const key of ['flag', 'config', 'env', 'text']) {
      standIns[key] = plantBrowserStandIn(join(work, 'bin', key), 'firefox', {
        version: 'Mozilla Firefox 140.0',
        argvFile: spawnedLog(key)
      })
    }

    const manifest = JSON.stringify({
      manifest_version: 3,
      name: 'Gecko System Profile',
      version: '1.0.0',
      background: {scripts: ['background.js']}
    })

    for (const source of ['flag', 'config', 'env'] as Source[]) {
      const dir = project(source)
      mkdirSync(join(dir, 'dist', 'firefox'), {recursive: true})
      writeFileSync(join(dir, 'manifest.json'), manifest)
      writeFileSync(join(dir, 'background.js'), 'console.log("bg")\n')
      // preview runs what is already built
      writeFileSync(join(dir, 'dist', 'firefox', 'manifest.json'), manifest)
      writeFileSync(
        join(dir, 'dist', 'firefox', 'background.js'),
        'console.log("bg")\n'
      )

      if (source === 'config') {
        writeFileSync(
          join(dir, 'extension.config.js'),
          'module.exports = {browser: {firefox: {profile: false}}}\n'
        )
      }
    }
  })

  afterAll(() => {
    rmSync(work, {recursive: true, force: true})
  })

  const argsFor = (source: Source, output: 'json' | 'pretty') => [
    command,
    project(source),
    '--browser',
    'firefox',
    '--gecko-binary',
    standIn(output === 'json' ? source : 'text'),
    '--no-open',
    ...(source === 'flag' ? ['--profile=false'] : []),
    ...(output === 'json' ? ['--output', 'json'] : [])
  ]

  const envFor = (source: Source): Record<string, string> =>
    source === 'env' ? {EXTENSION_USE_SYSTEM_PROFILE: 'true'} : {}

  it.each([
    'flag',
    'config',
    'env'
  ] as Source[])(`${command} refuses system profile mode set by %s without spawning the browser`, async (source) => {
    const {code, stdout} = await runCli(argsFor(source, 'json'), envFor(source))

    expect(existsSync(spawnedLog(source)), stdout).toBe(false)

    const failures = failureFrames(stdout)
    expect(failures, stdout).toHaveLength(1)
    expect(failures[0]).toMatchObject({command, status: 'usage'})
    expect(failures[0].error?.code).toBe('E_FLAG_NOT_SUPPORTED_HERE')
    expect(failures[0].error?.message).toContain(`SET BY ${NAMED[source]}`)
    expect(failures[0].error?.message).toContain('--profile=<path>')

    if (command === 'dev') {
      const ready = JSON.parse(
        readFileSync(
          join(
            project(source),
            'dist',
            'extension-js',
            'firefox',
            'ready.json'
          ),
          'utf-8'
        )
      )

      expect(ready).toMatchObject({
        status: 'error',
        code: 'browser_launch_failed',
        browserLaunchFailedCode: 'E_FLAG_NOT_SUPPORTED_HERE'
      })

      expect(ready.browserPid).toBeUndefined()
    }

    expect(code, stdout).toBe(1)
  }, 120_000)

  it(`${command} prints the refusal as one block in text mode`, async () => {
    const {stdout} = await runCli(argsFor('flag', 'pretty'), {})

    expect(existsSync(spawnedLog('text')), stdout).toBe(false)
    expect(
      stdout.split("can't load the add-on in its own profile").length - 1,
      stdout
    ).toBe(1)

    expect(stdout).toContain('SET BY --profile=false')
    expect(stdout).not.toMatch(/ready for development/)
  }, 120_000)
}

// The home is a temp folder, so system profile mode names no real profile.
describe.each([
  'dev',
  'start',
  'preview'
] as Command[])('%s on a Gecko browser in system profile mode', (command) =>
  geckoSystemProfileSpecs(command))

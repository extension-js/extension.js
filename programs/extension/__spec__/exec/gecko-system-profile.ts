import {spawn} from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, expect, it} from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(__dirname, '../..')
const cliBin = resolve(cliRoot, 'dist', 'cli.cjs')

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

// dev keeps serving after a launch it refused, so its run ends once the
// failure frame is out. start and preview end by themselves.
function runCli(
  args: string[],
  extraEnv: Record<string, string>,
  untilFailure: boolean
) {
  return new Promise<{code: number | null; stdout: string}>(
    (resolvePromise, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        EXTENSION_ENV: 'test',
        EXTENSION_TELEMETRY: '0',
        ...extraEnv
      }
      delete env.VITEST
      delete env.VITEST_WORKER_ID

      if (!extraEnv.EXTENSION_USE_SYSTEM_PROFILE) {
        delete env.EXTENSION_USE_SYSTEM_PROFILE
        delete env.EXTJS_USE_SYSTEM_PROFILE
      }

      const child = spawn(process.execPath, [cliBin, ...args], {
        cwd: cliRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        detached: true
      })
      let stdout = ''

      const stop = () => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL')
        } catch {
          // Already gone
        }
      }

      const timer = setTimeout(() => {
        stop()
        reject(new Error(`CLI did not report: ${args.join(' ')}\n${stdout}`))
      }, 100_000)

      const onData = (chunk: Buffer) => {
        stdout += chunk.toString()
        const json = args.includes('json')

        if (
          untilFailure &&
          stdout.includes(json ? '"ok":false' : 'own profile')
        ) {
          stop()
        }
      }

      child.stdout.on('data', onData)
      child.stderr.on('data', onData)

      child.on('close', (code) => {
        clearTimeout(timer)
        resolvePromise({code, stdout})
      })
    }
  )
}

function failureFrames(stdout: string): Frame[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Frame)
    .filter((frame) => !frame.ok)
}

// A Gecko browser on its own profile has remote debugging off, so the CLI
// must refuse before spawning it. The stand-in records any spawn it gets.
export function geckoSystemProfileSpecs(command: Command) {
  let work = ''

  const project = (source: Source) => join(work, `project-${source}`)
  // One stand-in per case, so a spawn in one case never fails another.
  const standIn = (key: string) => join(work, 'bin', key, 'firefox')
  const spawnedLog = (key: string) => join(work, `spawned-${key}.log`)

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), `extjs-gecko-system-${command}-`))

    for (const key of ['flag', 'config', 'env', 'text']) {
      mkdirSync(dirname(standIn(key)), {recursive: true})
      writeFileSync(
        standIn(key),
        '#!/bin/sh\n' +
          'if [ "$1" = "--version" ]; then echo "Mozilla Firefox 140.0"; exit 0; fi\n' +
          `echo "$$ $*" >> '${spawnedLog(key)}'\n` +
          'exit 0\n'
      )

      chmodSync(standIn(key), 0o755)
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
    const {code, stdout} = await runCli(
      argsFor(source, 'json'),
      envFor(source),
      command === 'dev'
    )

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
    } else {
      expect(code).not.toBe(0)
    }
  }, 120_000)

  it(`${command} prints the refusal as one block in text mode`, async () => {
    const {stdout} = await runCli(
      argsFor('flag', 'pretty'),
      {},
      command === 'dev'
    )

    expect(existsSync(spawnedLog('text')), stdout).toBe(false)
    expect(
      stdout.split("can't load the add-on in its own profile").length - 1,
      stdout
    ).toBe(1)

    expect(stdout).toContain('SET BY --profile=false')
    expect(stdout).not.toMatch(/ready for development/)
  }, 120_000)
}

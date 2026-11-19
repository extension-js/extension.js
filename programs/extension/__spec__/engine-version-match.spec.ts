import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import http from 'node:http'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {
  CLI_BIN,
  CLI_ROOT,
  cliEnv,
  framesIn,
  freshCliHome,
  stripAnsi
} from './helpers/run-cli'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()

const CLI_VERSION = String(
  JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'))
    .version
)
const OTHER_VERSION = '0.0.1'

// The compiled CLI's own dependencies, which a copy in a temp folder cannot
// reach by walking up. The engine beside the copy is still found first.
const DEPENDENCY_FOLDERS = [
  path.join(CLI_ROOT, 'node_modules'),
  path.resolve(CLI_ROOT, '../../node_modules')
].join(path.delimiter)

// An entry that gives itself away, for a refusal that has to come first.
const MUST_NOT_BE_IMPORTED = 'throw new Error("the engine was imported")\n'
// An engine that loads and fails the build with a code of its own.
const FAILS_THE_BUILD =
  'export async function extensionBuild() {\n' +
  '  throw Object.assign(new Error("stand-in build"), {code: "E_COMPILE"})\n' +
  '}\n'

function writeEngine(root: string, version: string, entrySource: string) {
  fs.mkdirSync(path.join(root, 'dist'), {recursive: true})
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'extension-develop', version})
  )

  for (const entry of ['module', 'preview', 'bridge']) {
    fs.writeFileSync(path.join(root, 'dist', `${entry}.mjs`), entrySource)
  }
}

// The compiled CLI as a package manager installs it, with a stand-in engine
// beside it. A copy, since a link would run from the checkout.
function installTheCli(engineVersion: string, entrySource: string) {
  const consumer = fs.realpathSync(makeTempFolder('extjs-engine-version-'))
  const cliRoot = path.join(consumer, 'node_modules', 'extension')
  const engineRoot = path.join(consumer, 'node_modules', 'extension-develop')
  const project = path.join(consumer, 'project')

  fs.mkdirSync(path.join(cliRoot, 'dist'), {recursive: true})
  fs.mkdirSync(project)
  // A project install, so the refusal names the project's own command.
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({name: 'consumer'})
  )

  fs.copyFileSync(
    path.join(CLI_ROOT, 'package.json'),
    path.join(cliRoot, 'package.json')
  )

  for (const file of fs.readdirSync(path.dirname(CLI_BIN))) {
    if (!file.endsWith('.cjs')) continue

    fs.copyFileSync(
      path.join(path.dirname(CLI_BIN), file),
      path.join(cliRoot, 'dist', file)
    )
  }

  writeEngine(engineRoot, engineVersion, entrySource)

  return {bin: path.join(cliRoot, 'dist', 'cli.cjs'), engineRoot, project}
}

type Install = ReturnType<typeof installTheCli>

interface RunOptions {
  env?: Record<string, string | undefined>
  telemetry?: boolean
}

// Awaited, so a collector in this process can answer the child.
function run(install: Install, args: string[], options: RunOptions = {}) {
  const child = spawn(process.execPath, [install.bin, ...args], {
    cwd: install.project,
    env: cliEnv({
      telemetry: options.telemetry,
      home: options.telemetry ? freshCliHome() : undefined,
      env: {NODE_PATH: DEPENDENCY_FOLDERS, ...options.env}
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000
  })
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))

  return new Promise<{
    status: number | null
    stdout: string
    stderr: string
    frames: ReturnType<typeof framesIn>
  }>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (status) => {
      resolve({
        status,
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        frames: framesIn(stdout)
      })
    })
  })
}

function refusalText(engineRoot: string): string {
  return (
    `extension@${CLI_VERSION} found extension-develop@${OTHER_VERSION} at ${engineRoot}. ` +
    'The two run together only at the same version.\n' +
    `Reinstall so both are ${CLI_VERSION}: npm install extension@${CLI_VERSION}\n` +
    'To run a local engine on purpose, set EXTENSION_DEVELOP_ROOT to its folder.'
  )
}

describe('an installed CLI beside a build engine of another version', () => {
  let install: Install

  beforeAll(() => {
    if (!fs.existsSync(CLI_BIN)) {
      throw new Error(`${CLI_BIN} is missing: run pnpm compile first`)
    }

    install = installTheCli(OTHER_VERSION, MUST_NOT_BE_IMPORTED)
  })

  it.each([
    ['build'],
    ['dev'],
    ['start'],
    ['preview'],
    ['logs']
  ])('refuses %s with one failed frame, the refusal on stderr and exit code 1', async (command) => {
    const result = await run(install, [command, '--output', 'json'])

    expect(result.status).toBe(1)
    expect(result.frames).toEqual([
      {
        schema: 1,
        ok: false,
        command,
        status: 'failed',
        value: null,
        error: {
          code: 'E_RUNTIME_NOT_FOUND',
          message: refusalText(install.engineRoot),
          name: 'Error'
        },
        warnings: []
      }
    ])

    expect(result.stderr).toBe(`⏵⏵⏵ ${refusalText(install.engineRoot)}\n`)
  })

  it('refuses doctor with the same code', async () => {
    const result = await run(install, ['doctor', '--output', 'json'])

    expect(result.status).toBe(1)
    expect(result.frames).toMatchObject([
      {
        ok: false,
        command: 'doctor',
        status: 'failed',
        error: {
          code: 'E_RUNTIME_NOT_FOUND',
          message: refusalText(install.engineRoot)
        }
      }
    ])
  })

  it('prints the refusal alone for a person, with no stack trace', async () => {
    const result = await run(install, ['build'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(`⏵⏵⏵ ${refusalText(install.engineRoot)}\n`)
  })

  it.each([
    [['--version'], `${CLI_VERSION}\n`],
    [['telemetry', 'status'], /^Telemetry: /],
    [['create', '--help'], /^Usage: extension create/],
    [['build', '--help'], /^Usage: extension build/]
  ])('runs %j, which never loads the engine', async (args, stdout) => {
    const result = await run(install, args)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)

    if (typeof stdout === 'string') expect(result.stdout).toBe(stdout)
    else expect(result.stdout).toMatch(stdout)
  })

  it('reports the failure to telemetry with the code and no new property', async () => {
    const events: Array<{event: string; properties: Record<string, unknown>}> =
      []
    const server = http.createServer((req, res) => {
      let body = ''

      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        if (req.url === '/capture/') events.push(...JSON.parse(body).batch)

        res.writeHead(200, {'content-type': 'application/json'})
        res.end('{"status":1}')
      })
    })

    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve())
    )

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    try {
      const refused = await run(install, ['build'], {
        telemetry: true,
        env: {
          POSTHOG_HOST: `http://127.0.0.1:${port}`,
          EXTENSION_TELEMETRY: '1',
          EXTENSION_TELEMETRY_TIMEOUT_MS: '5000'
        }
      })

      expect(refused.status).toBe(1)

      const failed = events.filter((event) => event.event === 'command_failed')

      expect(failed).toHaveLength(1)
      expect(failed[0].properties).toMatchObject({
        command: 'build',
        code: 'E_RUNTIME_NOT_FOUND',
        exit_code: 1
      })

      expect(JSON.stringify(events)).not.toContain(OTHER_VERSION)
      expect(JSON.stringify(events)).not.toContain(install.engineRoot)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('an installed CLI told to run a local engine of another version', () => {
  it('warns once on stderr and hands the build to that engine', async () => {
    const install = installTheCli(CLI_VERSION, MUST_NOT_BE_IMPORTED)
    const localRoot = path.join(
      fs.realpathSync(makeTempFolder('extjs-engine-local-')),
      'extension-develop'
    )

    writeEngine(localRoot, OTHER_VERSION, FAILS_THE_BUILD)

    const result = await run(install, ['build', '--output', 'json'], {
      env: {EXTENSION_DEVELOP_ROOT: localRoot}
    })
    const warning =
      `⏵⏵⏵ EXTENSION_DEVELOP_ROOT runs extension-develop@${OTHER_VERSION} from ${localRoot} ` +
      `with extension@${CLI_VERSION}. The versions differ, so a failure here may come from the pair.`

    expect(result.stderr.split(warning)).toHaveLength(2)
    expect(result.stderr).not.toContain('The two run together only')
    // The stand-in engine was reached: the failure is the one it raises.
    expect(result.frames).toMatchObject([
      {ok: false, command: 'build', error: {code: 'E_COMPILE'}}
    ])

    expect(result.status).toBe(1)
  })
})

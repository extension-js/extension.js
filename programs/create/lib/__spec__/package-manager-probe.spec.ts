import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {fakeSpawn, missingBinary} from '../../__spec__/fake-spawn'
import {
  declarePackageManager,
  type VersionProbe,
  type VersionProbeOptions,
  versionProbeFolder,
  versionProbeWith
} from '../package-manager'

type Answer = Awaited<ReturnType<VersionProbe>> | Error

// Stands in for the binary through the probe seam, so no manager starts.
// Each call takes the next answer, and the last one repeats.
function recordingProbe(...answers: Answer[]) {
  const calls: Parameters<VersionProbe>[] = []

  const probe: VersionProbe = (...call) => {
    const answer = answers[Math.min(calls.length, answers.length - 1)]
    calls.push(call)
    if (answer instanceof Error) throw answer

    return answer
  }

  return {probe, calls, timeouts: () => calls.map((call) => call[2].timeout)}
}

// What Node hands back when the child outlives the timeout it was given.
function timedOut(): Awaited<ReturnType<VersionProbe>> {
  return {
    status: null,
    stdout: '',
    error: Object.assign(new Error('spawnSync npm ETIMEDOUT'), {
      code: 'ETIMEDOUT'
    })
  }
}

const REGISTRY_NAMES = ['npm_config_registry', 'corepack_npm_registry']
const tmpRoots: string[] = []
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.stubEnv('npm_config_user_agent', '')
  saved = {}

  for (const key of Object.keys(process.env)) {
    if (REGISTRY_NAMES.includes(key.toLowerCase())) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  }
})

afterEach(() => {
  vi.unstubAllEnvs()

  for (const key of Object.keys(process.env)) {
    if (REGISTRY_NAMES.includes(key.toLowerCase())) delete process.env[key]
  }

  Object.assign(process.env, saved)

  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function unpinnedProject(npmrc: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-corepack-probe-'))
  tmpRoots.push(dir)
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"unpinned"}\n')

  if (npmrc !== null) fs.writeFileSync(path.join(dir, '.npmrc'), npmrc)

  return dir
}

describe('the package manager version probe', () => {
  it('points Corepack at the registry the project .npmrc pins', async () => {
    const dir = unpinnedProject('registry=http://127.0.0.1:4882/\n')
    const {probe, calls} = recordingProbe({status: 0, stdout: '9.9.9\n'})

    expect(await declarePackageManager(dir, 'pnpm', probe)).toEqual({
      spec: 'pnpm@9.9.9'
    })

    expect(calls).toHaveLength(1)

    const [command, args, options] = calls[0]
    expect(command).toBe('pnpm')
    expect(args).toEqual(['--version'])
    expect(options.env?.COREPACK_NPM_REGISTRY).toBe('http://127.0.0.1:4882')
    expect(options.env?.PATH).toBe(process.env.PATH)
    // A manager that answers is asked once, with the short limit.
    expect(options.timeout).toBe(5000)
    expect(options.stdio).toEqual(['ignore', 'pipe', 'ignore'])
  })

  // A Corepack shim answers for the nearest manifest above where it starts.
  it.skipIf(process.platform === 'win32')(
    'asks from the project folder, not from where the create was started',
    async () => {
      const dir = unpinnedProject(null)
      const {probe, calls} = recordingProbe({status: 0, stdout: '9.9.9\n'})

      await declarePackageManager(dir, 'pnpm', probe)

      expect(calls[0][2].cwd).toBe(dir)
      expect(dir).not.toBe(process.cwd())
    }
  )

  it('names no folder to start in when the project folder is gone', async () => {
    const dir = path.join(unpinnedProject(null), 'never-made')
    const {probe, calls} = recordingProbe({status: 0, stdout: '9.9.9\n'})

    // A folder that does not exist would read as a manager that is missing.
    expect(await declarePackageManager(dir, 'pnpm', probe)).toEqual({
      spec: 'pnpm@9.9.9'
    })

    expect(calls[0][2]).not.toHaveProperty('cwd')
    expect(versionProbeFolder(dir, 'linux')).toBeUndefined()
  })

  // There a file named npm.cmd in the folder would run before the real npm.
  it('stays in the starting folder on Windows, where a template could answer', () => {
    const dir = unpinnedProject(null)

    expect(versionProbeFolder(dir, 'win32')).toBeUndefined()
    expect(versionProbeFolder(dir, 'darwin')).toBe(dir)
    expect(versionProbeFolder(dir, 'linux')).toBe(dir)
  })

  it('sets no Corepack registry for a project that pins none', async () => {
    const {probe, calls} = recordingProbe({status: 0, stdout: '9.9.9\n'})

    expect(
      await declarePackageManager(unpinnedProject(null), 'pnpm', probe)
    ).toEqual({spec: 'pnpm@9.9.9'})

    expect(calls[0][2].env).not.toHaveProperty('COREPACK_NPM_REGISTRY')
  })

  it.each([
    ['past a leading v', 'v1.2.3\n', '1.2.3'],
    ['with Windows line endings', '1.2.3\r\n', '1.2.3'],
    ['with a prerelease tag', '11.0.0-pre.2\n', '11.0.0-pre.2'],
    [
      'after a notice the shim printed first',
      'A new release of the shim is available: 2.0.1\r\n10.9.2\r\n',
      '10.9.2'
    ],
    ['before a line printed after it', '10.9.2\nDone in 0.2s\n', '10.9.2'],
    [
      'between two notices',
      'warning: config is deprecated\n\n10.9.2\n\nbye\n',
      '10.9.2'
    ]
  ])('reads the version %s', async (_label, stdout, version) => {
    const {probe, calls} = recordingProbe({status: 0, stdout})

    expect(
      await declarePackageManager(unpinnedProject(null), 'npm', probe)
    ).toEqual({
      spec: `npm@${version}`
    })

    expect(calls).toHaveLength(1)
  })

  it.each([
    ['a version inside a sentence', 'Usage: pnpm 9.9.9 [command]\n'],
    ['two numbers only', '9.9\n'],
    ['a version with words after it', '9.9.9 (stable)\n']
  ])('takes no version from %s', async (_label, stdout) => {
    const {probe, calls} = recordingProbe({status: 0, stdout})

    expect(
      await declarePackageManager(unpinnedProject(null), 'pnpm', probe)
    ).toEqual({undeclared: {kind: 'no-version'}})

    // Text is an answer, so asking again would get the same one.
    expect(calls).toHaveLength(1)
  })

  it.each([
    ['reports a timeout', timedOut()],
    ['was ended by a signal', {status: null, stdout: ''}]
  ])('asks once more, with more time, when the first probe %s', async (_label, first) => {
    const {probe, timeouts} = recordingProbe(first, {
      status: 0,
      stdout: '10.9.2\n'
    })

    expect(
      await declarePackageManager(unpinnedProject(null), 'npm', probe)
    ).toEqual({
      spec: 'npm@10.9.2'
    })

    expect(timeouts()).toEqual([5000, 15000])
  })

  it('tells the caller it is asking again only after a wait', async () => {
    const waits: number[][] = []
    const slow = recordingProbe(timedOut())
    const blank = recordingProbe({status: 0, stdout: ''})
    const note = (waited: number, limit: number) => waits.push([waited, limit])

    await declarePackageManager(unpinnedProject(null), 'npm', slow.probe, note)
    expect(waits).toEqual([[5, 15]])

    // A blank answer is asked again at once, with nothing to wait through.
    await declarePackageManager(unpinnedProject(null), 'npm', blank.probe, note)
    expect(blank.calls).toHaveLength(2)
    expect(waits).toEqual([[5, 15]])
  })

  it('gives up after the second timeout and says how long it waited', async () => {
    const {probe, timeouts} = recordingProbe(timedOut())

    expect(
      await declarePackageManager(unpinnedProject(null), 'npm', probe)
    ).toEqual({
      undeclared: {kind: 'timeout', seconds: 15}
    })

    expect(timeouts()).toEqual([5000, 15000])
  })

  it('asks once more when a clean exit printed nothing', async () => {
    const {probe, calls} = recordingProbe(
      {status: 0, stdout: ' \r\n'},
      {status: 0, stdout: '10.9.2\n'}
    )

    expect(
      await declarePackageManager(unpinnedProject(null), 'npm', probe)
    ).toEqual({
      spec: 'npm@10.9.2'
    })

    expect(calls).toHaveLength(2)
  })

  it('stops at two probes when both print nothing', async () => {
    const {probe, calls} = recordingProbe({status: 0, stdout: ''})

    expect(
      await declarePackageManager(unpinnedProject(null), 'npm', probe)
    ).toEqual({
      undeclared: {kind: 'no-version'}
    })

    expect(calls).toHaveLength(2)
  })

  // A failure the manager chose is not asked again: the answer would repeat.
  it.each<[string, Answer, unknown]>([
    [
      'exits non-zero, even with a version on stdout',
      {status: 3, stdout: '9.9.9\n'},
      {kind: 'exit', code: 3}
    ],
    ['throws that it is not on PATH', missingBinary('pnpm'), {kind: 'missing'}],
    [
      'comes back as not on PATH',
      {status: null, stdout: '', error: missingBinary('pnpm')},
      {kind: 'missing'}
    ],
    [
      // cross-spawn reports a missing Windows command this way.
      'comes back as not on PATH with the exit code of cmd.exe',
      {status: 1, stdout: '', error: missingBinary('pnpm')},
      {kind: 'missing'}
    ],
    [
      'cannot be started',
      {
        status: null,
        stdout: '',
        error: Object.assign(new Error('spawnSync pnpm EACCES'), {
          code: 'EACCES'
        })
      },
      {kind: 'spawn', code: 'EACCES'}
    ]
  ])('declares no manager, after one probe, when the binary %s', async (_label, answer, undeclared) => {
    const {probe, calls} = recordingProbe(answer)

    expect(
      await declarePackageManager(unpinnedProject(null), 'pnpm', probe)
    ).toEqual({undeclared})

    expect(calls).toHaveLength(1)
  })

  it('keeps a starter pin without asking the binary', async () => {
    const dir = unpinnedProject(null)
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      '{"name":"pinned","packageManager":"pnpm@8.15.0"}\n'
    )

    const {probe, calls} = recordingProbe(timedOut())

    expect(await declarePackageManager(dir, 'pnpm', probe)).toEqual({
      spec: 'pnpm@8.15.0'
    })

    expect(calls).toEqual([])
  })

  it('never probes for Deno, which declares no packageManager', async () => {
    const {probe, calls} = recordingProbe({status: 0, stdout: '2.0.0\n'})

    // No spec and no reason: the absence is the design, not a failure.
    expect(
      await declarePackageManager(unpinnedProject(null), 'deno', probe)
    ).toEqual({})

    expect(calls).toEqual([])
  })
})

// The child is a stand-in through the spawn seam, so no process starts.
describe('the child the version probe starts', () => {
  function optionsWith(timeout: number): VersionProbeOptions {
    return {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout,
      env: {} as NodeJS.ProcessEnv,
      cwd: 'here'
    }
  }

  it('hands back the exit code and what the manager printed', async () => {
    const {spawn, calls} = fakeSpawn(() => ({stdout: '10.9.2\n', exit: 0}))
    const answer = await versionProbeWith(spawn, 'linux')(
      'npm',
      ['--version'],
      optionsWith(1000)
    )

    expect(answer).toEqual({status: 0, stdout: '10.9.2\n'})
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ['npm', '--version']
    ])

    expect(calls[0].options).toEqual({
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {},
      cwd: 'here',
      windowsHide: true
    })
  })

  it('hands back the error of a manager that cannot start', async () => {
    const {spawn} = fakeSpawn(() => ({error: missingBinary('npm')}))
    const answer = await versionProbeWith(spawn, 'linux')(
      'npm',
      ['--version'],
      optionsWith(1000)
    )

    expect(answer).toMatchObject({status: null, error: {code: 'ENOENT'}})
  })

  // A .cmd shim runs the manager under cmd.exe, which a plain kill orphans.
  it('ends the whole tree on Windows when the limit runs out', async () => {
    const {spawn, calls} = fakeSpawn(() => ({stdout: 'starting\n'}))
    const answer = await versionProbeWith(spawn, 'win32')(
      'npm',
      ['--version'],
      optionsWith(20)
    )

    expect(answer).toMatchObject({
      status: null,
      stdout: 'starting\n',
      error: {code: 'ETIMEDOUT'}
    })

    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ['npm', '--version'],
      ['taskkill', '/pid', String(calls[0].pid), '/T', '/F']
    ])

    expect(calls[0].signals).toEqual([])
  })

  it('ends the child itself elsewhere when the limit runs out', async () => {
    const {spawn, calls} = fakeSpawn(() => ({}))
    const answer = await versionProbeWith(spawn, 'linux')(
      'npm',
      ['--version'],
      optionsWith(20)
    )

    expect(answer).toMatchObject({status: null, error: {code: 'ETIMEDOUT'}})
    expect(calls).toHaveLength(1)
    expect(calls[0].signals).toEqual(['SIGTERM'])
  })
})

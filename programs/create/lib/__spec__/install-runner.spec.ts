import type {ChildProcess} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'

import {fakeSpawn, missingBinary} from '../../__spec__/fake-spawn'
import {
  offlineRegistryEnv,
  offlineRegistryFiles,
  withoutInheritedRegistry
} from '../../__spec__/offline-registry-fixture'
import {
  buildExecEnv,
  installTimedOutReason,
  installTimeoutMs,
  invokingNpmrcReleaseAge,
  KILL_GRACE_MS,
  runInstall,
  TREE_END_WAIT_MS,
  windowsTaskkillPath,
  withoutInheritedReleaseAge
} from '../install-runner'

type Env = Record<string, string | undefined>

const tmpRoots: string[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()

  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

// A checkout whose .npmrc sets a release age, the way this repository does.
function checkoutWithNpmrc(age: string | null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-npmrc-'))
  tmpRoots.push(root)
  const nested = path.join(root, 'programs', 'create')
  fs.mkdirSync(nested, {recursive: true})

  if (age !== null) {
    fs.writeFileSync(
      path.join(root, '.npmrc'),
      `auto-install-peers=true\nminimum-release-age=${age}\n`
    )
  }

  return nested
}

function pinnedProject(npmrc: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-corepack-pin-'))
  tmpRoots.push(dir)
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    '{"name":"pinned","packageManager":"pnpm@9.9.9"}\n'
  )

  if (npmrc !== null) fs.writeFileSync(path.join(dir, '.npmrc'), npmrc)

  return dir
}

describe('install-runner runInstall', () => {
  it('passes the command and args to spawn with no shell option', async () => {
    // A shell would join these into one cmd.exe string, so the project path
    // must reach the package manager as a single untouched argument.
    const cwd = 'C:\\Users\\me & echo pwned\\my ext'
    const args = ['install', '--ignore-scripts']
    const {spawn, calls} = fakeSpawn(() => ({exit: 0}))

    const result = await runInstall('pnpm.cmd', args, {
      cwd,
      stdio: 'pipe',
      spawn
    })

    expect(result).toEqual({code: 0, stdout: '', stderr: ''})
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('pnpm.cmd')
    expect(calls[0].args).toEqual(args)
    expect(calls[0].options).not.toHaveProperty('shell')
    expect(calls[0].options.cwd).toBe(cwd)
    // Stdin is closed: a manager that asks a question reads its end at once.
    expect(calls[0].options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    // The child gets the built env, which the table below reads directly.
    expect(calls[0].options.env).toEqual(buildExecEnv(process.env, cwd))
  })

  it('answers the exit code with what the child wrote to each stream', async () => {
    const {spawn} = fakeSpawn(() => ({
      exit: 1,
      stdout: 'resolving\n',
      stderr: 'npm error code E404\n'
    }))

    await expect(
      runInstall('npm', ['install'], {cwd: os.tmpdir(), stdio: 'pipe', spawn})
    ).resolves.toEqual({
      code: 1,
      stdout: 'resolving\n',
      stderr: 'npm error code E404\n'
    })
  })

  it('answers the signal that ended a child that has no exit code', async () => {
    const {spawn} = fakeSpawn(() => ({exit: null, signal: 'SIGKILL'}))

    await expect(
      runInstall('npm', ['install'], {cwd: os.tmpdir(), stdio: 'pipe', spawn})
    ).resolves.toEqual({code: null, signal: 'SIGKILL', stdout: '', stderr: ''})
  })

  it('tee writes each stream through as it arrives and still captures it', async () => {
    const {spawn, calls} = fakeSpawn(() => ({
      exit: 1,
      stdout: 'resolving\n',
      stderr: 'npm error code E404\n'
    }))
    const shown: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      shown.push(`out:${String(chunk)}`)

      return true
    })

    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      shown.push(`err:${String(chunk)}`)

      return true
    })

    const result = await runInstall('npm', ['install'], {
      cwd: os.tmpdir(),
      stdio: 'tee',
      spawn
    }).finally(() => vi.restoreAllMocks())

    expect(result).toEqual({
      code: 1,
      stdout: 'resolving\n',
      stderr: 'npm error code E404\n'
    })

    expect(shown).toEqual(['out:resolving\n', 'err:npm error code E404\n'])
    // Stdin stays the terminal's, the way a plain inherit left it.
    expect(calls[0].options.stdio).toEqual(['inherit', 'pipe', 'pipe'])
  })

  it('pipe captures the streams and shows nothing', async () => {
    const {spawn} = fakeSpawn(() => ({exit: 0, stdout: 'quiet\n'}))
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    const result = await runInstall('npm', ['install'], {
      cwd: os.tmpdir(),
      stdio: 'pipe',
      spawn
    })
    const shown = write.mock.calls.length
    vi.restoreAllMocks()

    expect(result.stdout).toBe('quiet\n')
    expect(shown).toBe(0)
  })

  it('rejects with the spawn error when the binary is missing', async () => {
    vi.useFakeTimers()
    const {spawn, calls} = fakeSpawn((command) => ({
      error: missingBinary(command)
    }))

    await expect(
      runInstall('pnpm', ['install'], {cwd: os.tmpdir(), stdio: 'pipe', spawn})
    ).rejects.toMatchObject({
      name: 'Error',
      code: 'ENOENT',
      syscall: 'spawn pnpm',
      path: 'pnpm',
      message: 'spawn pnpm ENOENT'
    })

    expect(calls[0].signals).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  describe('the install timeout', () => {
    it.each([
      [1, '1 ms'],
      [400, '400 ms'],
      [999, '999 ms'],
      [1000, '1 second'],
      [1500, '1.5 seconds'],
      [1999, '2 seconds'],
      [5000, '5 seconds'],
      [90_000, '90 seconds'],
      [1_800_000, '30 minutes']
    ])('reads a %i ms budget as "%s"', (ms, words) => {
      expect(installTimedOutReason(ms)).toBe(
        `The install did not finish within ${words} (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)`
      )
    })

    it('kills a child that outlives the timeout and names the variable', async () => {
      vi.useFakeTimers()
      const {spawn, calls} = fakeSpawn(() => ({
        stdout: 'Corepack is about to download pnpm. Continue? [Y/n]\n'
      }))

      const run = runInstall('pnpm', ['install'], {
        cwd: os.tmpdir(),
        stdio: 'pipe',
        spawn,
        platform: 'linux',
        timeoutMs: 5000
      })

      await vi.advanceTimersByTimeAsync(4999)
      expect(calls[0].signals).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      expect(calls[0].signals).toEqual(['SIGTERM'])

      // Settled without a close event: an orphan can hold the pipes open.
      await expect(run).resolves.toEqual({
        code: null,
        stdout: 'Corepack is about to download pnpm. Continue? [Y/n]\n',
        stderr: '',
        reason:
          'The install did not finish within 5 seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)'
      })

      expect(calls).toHaveLength(1)
    })

    it('ends the whole process tree on Windows, where the child is a shim', async () => {
      vi.useFakeTimers()
      const {spawn, calls} = fakeSpawn(() => ({}))

      const run = runInstall('pnpm', ['install'], {
        cwd: os.tmpdir(),
        stdio: 'pipe',
        spawn,
        platform: 'win32',
        timeoutMs: 5000
      })
      let answered = false

      void run.then(() => {
        answered = true
      })

      // This taskkill never finishes. The answer waits for it, with a bound,
      // since a caller removes the folder the tree runs in right after.
      await vi.advanceTimersByTimeAsync(5000 + TREE_END_WAIT_MS - 1)
      expect(answered).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      await expect(run).resolves.toMatchObject({
        code: null,
        reason:
          'The install did not finish within 5 seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)'
      })

      expect(calls.map((call) => [call.command, ...call.args])).toEqual([
        ['pnpm', 'install'],
        [windowsTaskkillPath(), '/pid', String(calls[0].pid), '/T', '/F']
      ])

      expect(calls[1].options).toEqual({stdio: 'ignore'})
      // A grandchild that outlives the tree kill cannot keep this process up.
      expect(calls[0].destroyed).toEqual(['stdout', 'stderr'])
      expect(calls[0].options).not.toHaveProperty('detached')
      expect(calls[0].signals).toEqual([])
    })

    // taskkill ends the manager before it answers, and that exit is the
    // timeout's own doing, not the install failing with a code.
    it('reports the timeout when the ended child closes before taskkill answers', async () => {
      vi.useFakeTimers()
      const {spawn: faked} = fakeSpawn(() => ({}))
      const children: ChildProcess[] = []

      const spawn: typeof faked = (...input) => {
        const child = faked(...input)

        children.push(child)

        return child
      }

      const run = runInstall('pnpm', ['install'], {
        cwd: os.tmpdir(),
        stdio: 'pipe',
        spawn,
        platform: 'win32',
        timeoutMs: 5000
      })

      await vi.advanceTimersByTimeAsync(5000)
      children[0].emit('close', 1, null)
      await vi.advanceTimersByTimeAsync(TREE_END_WAIT_MS)

      await expect(run).resolves.toEqual({
        code: null,
        stdout: '',
        stderr: '',
        reason:
          'The install did not finish within 5 seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)'
      })
    })

    // The shim is killed only once taskkill has failed: a kill before it ran
    // would end the shim alone and orphan the manager it started.
    it.each([
      ['cannot start', ['SIGKILL'], {error: missingBinary('taskkill')}],
      ['refuses', ['SIGKILL'], {exit: 1}],
      ['ends the tree', [], {exit: 0}]
    ])('on Windows, when taskkill %s, the shim receives %j', async (_case, signals, taskkill) => {
      vi.useFakeTimers()
      const {spawn, calls} = fakeSpawn((command) =>
        command === windowsTaskkillPath() ? taskkill : {}
      )

      const run = runInstall('pnpm', ['install'], {
        cwd: os.tmpdir(),
        stdio: 'pipe',
        spawn,
        platform: 'win32',
        timeoutMs: 5000
      })

      await vi.advanceTimersByTimeAsync(5000)
      await expect(run).resolves.toMatchObject({code: null})

      expect(calls.map((call) => call.command)).toEqual([
        'pnpm',
        windowsTaskkillPath()
      ])

      expect(calls[0].signals).toEqual(signals)
    })

    // A taskkill earlier on PATH, such as one a project folder ships, never runs.
    it.each([
      [{SystemRoot: 'D:\\Windows'}, 'D:\\Windows\\System32\\taskkill.exe'],
      [{windir: 'E:\\WINNT'}, 'E:\\WINNT\\System32\\taskkill.exe'],
      [{}, 'C:\\Windows\\System32\\taskkill.exe']
    ])('starts taskkill from the system folder for %o', (env, expected) => {
      expect(windowsTaskkillPath(env)).toBe(expected)
    })

    it('ends the whole group on POSIX, then kills what is left after the grace', async () => {
      vi.useFakeTimers()
      const {spawn, calls} = fakeSpawn(() => ({}))
      const signaled: Array<[number, string]> = []

      const run = runInstall('pnpm', ['install'], {
        cwd: os.tmpdir(),
        stdio: 'pipe',
        spawn,
        platform: 'linux',
        timeoutMs: 5000,
        signalGroup: (pid, signal) => {
          signaled.push([pid, signal])
        }
      })

      expect(calls[0].options.detached).toBe(true)

      await vi.advanceTimersByTimeAsync(5000)
      await expect(run).resolves.toMatchObject({code: null})
      expect(signaled).toEqual([[calls[0].pid, 'SIGTERM']])

      await vi.advanceTimersByTimeAsync(KILL_GRACE_MS)
      expect(signaled).toEqual([
        [calls[0].pid, 'SIGTERM'],
        [calls[0].pid, 'SIGKILL']
      ])

      // The group got the signals, never the leader alone.
      expect(calls[0].signals).toEqual([])
    })

    it('keeps a child that shares the terminal in its group', async () => {
      vi.useFakeTimers()
      const {spawn, calls} = fakeSpawn(() => ({}))
      const signaled: string[] = []
      vi.spyOn(process.stdout, 'write').mockReturnValue(true)

      const run = runInstall('pnpm', ['install'], {
        cwd: os.tmpdir(),
        stdio: 'tee',
        spawn,
        platform: 'linux',
        timeoutMs: 5000,
        signalGroup: (_pid, signal) => {
          signaled.push(signal)
        }
      })

      await vi.advanceTimersByTimeAsync(5000)
      await expect(run).resolves.toMatchObject({code: null})
      vi.restoreAllMocks()

      expect(calls[0].options).not.toHaveProperty('detached')
      expect(calls[0].signals).toEqual(['SIGTERM'])
      expect(signaled).toEqual([])
    })

    it('passes Ctrl+C on to the group and stops listening once it ends', async () => {
      vi.useFakeTimers()
      const {spawn, calls} = fakeSpawn(() => ({}))
      const signaled: Array<[number, string]> = []

      // Another listener keeps the forwarded signal from ending this run.
      const keepAlive = () => {}

      process.on('SIGINT', keepAlive)
      const before = process.listenerCount('SIGINT')

      try {
        const run = runInstall('pnpm', ['install'], {
          cwd: os.tmpdir(),
          stdio: 'pipe',
          spawn,
          platform: 'linux',
          timeoutMs: 5000,
          signalGroup: (pid, signal) => {
            signaled.push([pid, signal])
          }
        })

        expect(process.listenerCount('SIGINT')).toBe(before + 1)
        process.emit('SIGINT', 'SIGINT')

        expect(signaled).toEqual([[calls[0].pid, 'SIGINT']])
        expect(process.listenerCount('SIGINT')).toBe(before)

        await vi.advanceTimersByTimeAsync(5000)
        await expect(run).resolves.toMatchObject({code: null})
      } finally {
        process.off('SIGINT', keepAlive)
      }
    })

    it('leaves a child that ends in time alone and arms nothing after it', async () => {
      vi.useFakeTimers()
      const {spawn, calls} = fakeSpawn(() => ({exit: 0}))

      const result = await runInstall('npm', ['install'], {
        cwd: os.tmpdir(),
        stdio: 'pipe',
        spawn,
        timeoutMs: 5000
      })

      expect(result).toEqual({code: 0, stdout: '', stderr: ''})
      expect(vi.getTimerCount()).toBe(0)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(calls[0].signals).toEqual([])
    })

    it('reads the timeout from EXTENSION_CREATE_INSTALL_TIMEOUT_MS when none is passed', async () => {
      vi.useFakeTimers()
      vi.stubEnv('EXTENSION_CREATE_INSTALL_TIMEOUT_MS', '90000')
      const {spawn, calls} = fakeSpawn(() => ({}))

      const run = runInstall('npm', ['install'], {
        cwd: os.tmpdir(),
        stdio: 'pipe',
        spawn,
        platform: 'darwin'
      })

      await vi.advanceTimersByTimeAsync(89_999)
      expect(calls[0].signals).toEqual([])

      await vi.advanceTimersByTimeAsync(1)

      await expect(run).resolves.toMatchObject({
        code: null,
        reason:
          'The install did not finish within 90 seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)'
      })

      expect(calls[0].signals).toEqual(['SIGTERM'])
    })

    it.each([
      ['unset', undefined, 1_800_000],
      ['empty', '', 1_800_000],
      ['not a number', 'soon', 1_800_000],
      ['zero', '0', 1_800_000],
      ['negative', '-5', 1_800_000],
      ['a number of milliseconds', '90000', 90_000],
      ['longer than a timer can wait', '99999999999', 2_147_483_647]
    ])('allows %s as the timeout: %s gives %i ms', (_label, value, expected) => {
      expect(
        installTimeoutMs({EXTENSION_CREATE_INSTALL_TIMEOUT_MS: value})
      ).toBe(expected)
    })

    it('leaves the fetch timeout variable out of the install timeout', () => {
      expect(installTimeoutMs({EXTENSION_CREATE_TIMEOUT_MS: '80'})).toBe(
        1_800_000
      )
    })
  })

  describe('release-age rule in the child env', () => {
    it('reads the rule from the .npmrc above where the package manager ran', () => {
      const nested = checkoutWithNpmrc('4320')

      expect(invokingNpmrcReleaseAge({INIT_CWD: nested}, os.tmpdir())).toBe(
        '4320'
      )

      expect(invokingNpmrcReleaseAge({}, nested)).toBe('4320')
      expect(invokingNpmrcReleaseAge({}, checkoutWithNpmrc(null))).toBeNull()
    })

    // pnpm 10 reads its settings from pnpm-workspace.yaml as well, and a value
    // there wins over .npmrc in the same folder, as pnpm config get answers.
    it.each([
      ['a bare number', 'minimumReleaseAge: 4320\n', '4320'],
      ['a quoted number', "minimumReleaseAge: '4320'\n", '4320'],
      ['a comment after it', 'minimumReleaseAge: 4320 # three days\n', '4320'],
      [
        'its exclusions beside it',
        'minimumReleaseAge: 60\nminimumReleaseAgeExclude:\n  - image-size\n',
        '60'
      ]
    ])('reads the rule from the pnpm-workspace.yaml above, with %s', (_label, yaml, expected) => {
      const nested = checkoutWithNpmrc(null)
      fs.writeFileSync(
        path.join(nested, '..', '..', 'pnpm-workspace.yaml'),
        `packages:\n  - './programs/*'\n${yaml}`
      )

      expect(invokingNpmrcReleaseAge({INIT_CWD: nested}, os.tmpdir())).toBe(
        expected
      )
    })

    it('takes the pnpm-workspace.yaml value over .npmrc in the same folder', () => {
      const nested = checkoutWithNpmrc('10')
      fs.writeFileSync(
        path.join(nested, '..', '..', 'pnpm-workspace.yaml'),
        'minimumReleaseAge: 4320\n'
      )

      expect(invokingNpmrcReleaseAge({}, nested)).toBe('4320')
    })

    it('reads no rule from a key nested under another setting', () => {
      const nested = checkoutWithNpmrc(null)
      fs.writeFileSync(
        path.join(nested, '..', '..', 'pnpm-workspace.yaml'),
        'catalog:\n  minimumReleaseAge: 4320\n'
      )

      expect(invokingNpmrcReleaseAge({}, nested)).toBeNull()
    })

    it('drops the value the checkout .npmrc exported and its exclusions', () => {
      const env = withoutInheritedReleaseAge(
        {
          npm_config_minimum_release_age: '4320',
          npm_config_minimum_release_age_exclude: 'image-size',
          npm_config_user_agent: 'pnpm/10'
        },
        '4320'
      )

      expect(env).toEqual({npm_config_user_agent: 'pnpm/10'})
    })

    it('keeps a rule the user exported on purpose', () => {
      const exported = {
        npm_config_minimum_release_age: '10080',
        pnpm_config_minimum_release_age: '10080'
      }

      expect(withoutInheritedReleaseAge(exported, '4320')).toEqual(exported)
      expect(withoutInheritedReleaseAge(exported, null)).toEqual(exported)
    })
  })

  describe('buildExecEnv', () => {
    const NODE_WIN = 'C:\\Program Files\\nodejs\\node.exe'
    const NODE_DIR_WIN = 'C:\\Program Files\\nodejs'

    // Read by name ignoring case, the way a Windows child reads its env.
    function named(env: Env, names: string[]): Env {
      return Object.fromEntries(
        Object.keys(env)
          .filter((key) => names.includes(key.toLowerCase()))
          .map((key) => [key, env[key]])
      )
    }

    it('hands the user rule to the child and strips the one the checkout exported', () => {
      const INIT_CWD = checkoutWithNpmrc('4320')

      expect(
        buildExecEnv(
          {
            INIT_CWD,
            npm_config_minimum_release_age: '10080',
            npm_config_minimum_release_age_exclude: 'image-size'
          },
          os.tmpdir(),
          'linux'
        )
      ).toEqual({
        INIT_CWD,
        npm_config_minimum_release_age: '10080',
        npm_config_minimum_release_age_exclude: 'image-size'
      })

      // The negative control: the checkout value is the one that goes.
      expect(
        buildExecEnv(
          {
            INIT_CWD,
            npm_config_minimum_release_age: '4320',
            npm_config_minimum_release_age_exclude: 'image-size',
            npm_config_user_agent: 'pnpm/10'
          },
          os.tmpdir(),
          'linux'
        )
      ).toEqual({INIT_CWD, npm_config_user_agent: 'pnpm/10'})
    })

    it.each<{
      name: string
      npmrc: string | null
      source: Env
      corepack: string | undefined
    }>([
      {
        name: 'points Corepack at the registry the project .npmrc pins',
        npmrc: 'registry=http://127.0.0.1:4875/\n',
        source: {},
        corepack: 'http://127.0.0.1:4875'
      },
      {
        name: 'points Corepack at a registry exported in the environment',
        npmrc: null,
        source: {npm_config_registry: 'http://127.0.0.1:4876/'},
        corepack: 'http://127.0.0.1:4876'
      },
      {
        name: 'lets the exported registry outrank the project .npmrc',
        npmrc: 'registry=http://127.0.0.1:4875/\n',
        source: {NPM_CONFIG_REGISTRY: 'http://127.0.0.1:4876/'},
        corepack: 'http://127.0.0.1:4876'
      },
      {
        name: 'keeps the Corepack registry the user exported',
        npmrc: 'registry=http://127.0.0.1:4875/\n',
        source: {COREPACK_NPM_REGISTRY: 'http://127.0.0.1:4877'},
        corepack: 'http://127.0.0.1:4877'
      },
      {
        name: 'sets no Corepack registry for a project that pins none',
        npmrc: null,
        source: {},
        corepack: undefined
      },
      {
        name: 'sets no Corepack registry for the public registry',
        npmrc: 'registry=https://registry.npmjs.org/\n',
        source: {},
        corepack: undefined
      }
    ])('$name', ({npmrc, source, corepack}) => {
      const env = buildExecEnv(source, pinnedProject(npmrc), 'linux')

      expect(env).toEqual(
        corepack === undefined || source.COREPACK_NPM_REGISTRY
          ? source
          : {...source, COREPACK_NPM_REGISTRY: corepack}
      )

      expect(env.COREPACK_NPM_REGISTRY).toBe(corepack)
    })

    it('hands the manager and Corepack the loopback pin the offline fixture sets, under one casing', () => {
      const REGISTRY_NAMES = ['npm_config_registry', 'corepack_npm_registry']
      const registry = 'http://127.0.0.1:4878/'
      const cwd = pinnedProject(offlineRegistryFiles(registry)['.npmrc'])
      const pinned = {
        ...withoutInheritedRegistry({
          NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
          COREPACK_NPM_REGISTRY: 'https://registry.npmjs.org'
        }),
        ...offlineRegistryEnv(registry)
      }

      expect(pinned).toEqual({
        npm_config_registry: registry,
        COREPACK_NPM_REGISTRY: 'http://127.0.0.1:4878'
      })

      expect(
        named(buildExecEnv({HOME: '/home/me', ...pinned}, cwd), REGISTRY_NAMES)
      ).toEqual(pinned)
    })

    it.each<{
      name: string
      platform: NodeJS.Platform
      source: Env
      expected: Env
    }>([
      {
        name: 'leaves PATH alone on linux',
        platform: 'linux',
        source: {PATH: '/usr/bin', HOME: '/home/me'},
        expected: {PATH: '/usr/bin', HOME: '/home/me'}
      },
      {
        name: 'leaves PATH alone on darwin',
        platform: 'darwin',
        source: {PATH: '/usr/bin:/bin'},
        expected: {PATH: '/usr/bin:/bin'}
      },
      {
        name: 'adds no PATH on linux when there is none',
        platform: 'linux',
        source: {HOME: '/home/me'},
        expected: {HOME: '/home/me'}
      },
      {
        name: 'puts the Node directory first on Windows, under both casings',
        platform: 'win32',
        source: {PATH: 'C:\\Windows\\system32', USERPROFILE: 'C:\\Users\\me'},
        expected: {
          PATH: `${NODE_DIR_WIN};C:\\Windows\\system32`,
          Path: `${NODE_DIR_WIN};C:\\Windows\\system32`,
          USERPROFILE: 'C:\\Users\\me'
        }
      },
      {
        name: 'reads the Windows casing when that is the one set',
        platform: 'win32',
        source: {Path: 'C:\\Windows\\system32'},
        expected: {
          PATH: `${NODE_DIR_WIN};C:\\Windows\\system32`,
          Path: `${NODE_DIR_WIN};C:\\Windows\\system32`
        }
      },
      {
        name: 'leaves a Windows PATH that already has the Node directory',
        platform: 'win32',
        source: {Path: `C:\\Windows\\system32;${NODE_DIR_WIN}`},
        expected: {Path: `C:\\Windows\\system32;${NODE_DIR_WIN}`}
      },
      {
        name: 'gives a Windows child with no PATH the Node directory alone',
        platform: 'win32',
        source: {USERPROFILE: 'C:\\Users\\me'},
        expected: {
          PATH: `${NODE_DIR_WIN};`,
          Path: `${NODE_DIR_WIN};`,
          USERPROFILE: 'C:\\Users\\me'
        }
      }
    ])('$name', ({platform, source, expected}) => {
      const before = {...source}

      expect(
        buildExecEnv(source, pinnedProject(null), platform, NODE_WIN)
      ).toEqual(expected)

      // The caller's env is read, never written.
      expect(source).toEqual(before)
    })
  })
})

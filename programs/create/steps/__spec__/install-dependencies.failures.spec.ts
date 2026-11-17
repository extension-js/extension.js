import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {type FakeRun, fakeSpawn, missingBinary} from '../../__spec__/fake-spawn'
import {type InstallRunner, runInstall} from '../../lib/install-runner'
import {shellQuote} from '../../lib/utils'
import {installDependencies} from '../install-dependencies'

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

let projectPath: string

beforeEach(async () => {
  vi.stubEnv('EXTENSION_ENV', '')
  vi.stubEnv('EXTENSION_CREATE_INSTALL_TIMEOUT_MS', '')
  projectPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-install-fail-'))
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  await fsp.rm(projectPath, {recursive: true, force: true})
})

async function writePackageJson(devDependencies: Record<string, string>) {
  await fsp.writeFile(
    path.join(projectPath, 'package.json'),
    `${JSON.stringify({name: 'ghost', devDependencies})}\n`
  )
}

// The real runner over a spawn that starts nothing, so the step, the runner
// and the frame are all the production ones.
function installWith(script: (command: string, args: string[]) => FakeRun) {
  const {spawn, calls} = fakeSpawn(script)
  const logged: string[] = []
  const errors: string[] = []
  const runner: InstallRunner = (command, args, opts) =>
    runInstall(command, args, {...opts, spawn, platform: 'linux'})

  return {
    calls,
    logged,
    errors,
    run: (manager: 'npm' | 'pnpm', template?: string) =>
      installDependencies(
        projectPath,
        'ghost',
        {
          log: (...args: unknown[]) => logged.push(args.map(String).join(' ')),
          error: (...args: unknown[]) => errors.push(args.map(String).join(' '))
        },
        manager,
        template,
        runner
      )
  }
}

// Resolves with the rejection so the frame it carries reads without colors.
async function installFailure(run: Promise<unknown>) {
  const error = await run.then(
    () => {
      throw new Error('expected the install to reject')
    },
    (thrown: Error) => thrown
  )

  return {
    name: error.name,
    frame: String(error.message).replace(ANSI, ''),
    cause: (error as {cause?: unknown}).cause
  }
}

const framesIn = (text: string) =>
  text.match(/Couldn't install the dependencies/g) ?? []

describe('installDependencies failure paths', () => {
  it('answers a missing package manager binary with one install frame that names the manager', async () => {
    await writePackageJson({extension: '4.1.30'})
    const install = installWith((command) => ({error: missingBinary(command)}))

    const failure = await installFailure(install.run('pnpm', 'react'))

    expect(failure.name).toBe('Error')
    expect(failure.frame.replace(/^\S+ /, '')).toBe(
      "Couldn't install the dependencies for ghost.\n" +
        'REASON Error: spawn pnpm ENOENT\n' +
        'The install process exited unexpectedly.\n' +
        'The new project files were removed. Fix the error above, then run ' +
        `extension create ${shellQuote(projectPath)} --template react --install again.`
    )

    // The frame travels on the error, so nothing else reports the failure.
    expect(framesIn(failure.frame)).toHaveLength(1)
    expect(install.errors).toEqual([])
    expect(install.logged).toHaveLength(1)
    expect(install.calls.map((call) => [call.command, ...call.args])).toEqual([
      ['pnpm', 'install']
    ])

    // The spawn error itself, so a caller reads its code and not the text.
    expect(failure.cause).toMatchObject({
      code: 'ENOENT',
      syscall: 'spawn pnpm',
      message: 'spawn pnpm ENOENT'
    })
  })

  // A fault of ours inside the install takes the same frame. The original must
  // survive whole: the REASON row is cut to fit and carries no stack.
  it('keeps a programming error as the cause of the install frame', async () => {
    await writePackageJson({extension: '4.1.30'})
    const fault = new TypeError(
      "Cannot read properties of undefined (reading 'code')"
    )
    const errors: string[] = []

    const failure = await installFailure(
      installDependencies(
        projectPath,
        'ghost',
        {
          log: () => {},
          error: (...args: unknown[]) => errors.push(args.map(String).join(' '))
        },
        'npm',
        undefined,
        async () => {
          throw fault
        }
      )
    )

    expect(failure.name).toBe('Error')
    expect(failure.frame.split('\n').slice(0, 3)).toEqual([
      "⏵⏵⏵ Couldn't install the dependencies for ghost.",
      "REASON TypeError: Cannot read properties of undefined (reading 'code')",
      'The install process exited unexpectedly.'
    ])

    expect(framesIn(failure.frame)).toHaveLength(1)
    expect(failure.cause).toBe(fault)
    expect(errors).toEqual([])
  })

  it('kills an install that exceeds the timeout and answers one frame naming the timeout', async () => {
    await writePackageJson({extension: '4.1.30'})
    vi.stubEnv('EXTENSION_CREATE_INSTALL_TIMEOUT_MS', '5000')
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    const install = installWith(() => ({
      stdout: 'Corepack is about to download pnpm. Continue? [Y/n]\n'
    }))

    const failed = installFailure(install.run('pnpm'))

    await vi.waitFor(() => expect(install.calls).toHaveLength(1))
    expect(install.calls[0].signals).toEqual([])

    await vi.advanceTimersByTimeAsync(5000)
    const failure = await failed

    expect(install.calls[0].signals).toEqual(['SIGTERM'])
    expect(failure.name).toBe('Error')
    expect(failure.frame.replace(/^\S+ /, '')).toBe(
      "Couldn't install the dependencies.\n" +
        'COMMAND pnpm install\n' +
        'EXIT null\n' +
        'REASON The install did not finish within 5 seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)\n' +
        'Corepack is about to download pnpm. Continue? [Y/n]\n' +
        'The new project files were removed. Fix the error above, then run ' +
        `extension create ${shellQuote(projectPath)} --install again.`
    )

    expect(framesIn(failure.frame)).toHaveLength(1)
    expect(install.errors).toEqual([])
    // A timeout is not a missing version, so nothing runs a second time.
    expect(install.calls).toHaveLength(1)
  })

  it('keeps the timeout in the frame when the hung install wrote more than the frame holds', async () => {
    await writePackageJson({extension: '4.1.30'})
    vi.stubEnv('EXTENSION_CREATE_INSTALL_TIMEOUT_MS', '5000')
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    const install = installWith(() => ({
      stdout: `${'progress '.repeat(200)}\n`
    }))

    const failed = installFailure(install.run('npm'))

    await vi.waitFor(() => expect(install.calls).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(5000)

    expect((await failed).frame).toContain(
      'REASON The install did not finish within 5 seconds (EXTENSION_CREATE_INSTALL_TIMEOUT_MS)\nprogress '
    )
  })

  it("reports the retry's output when the install fails again after the tag rewrite", async () => {
    await writePackageJson({extension: '^2.1.0'})
    const runs: FakeRun[] = [
      {
        exit: 1,
        stderr:
          'npm error code ETARGET\nnpm error notarget No matching version found for extension@^2.1.0\n'
      },
      {
        exit: 7,
        stdout: 'resolving extension@latest\n',
        stderr: 'npm error code ECONNRESET\nnpm error network socket hang up\n'
      }
    ]
    const install = installWith(() => runs.shift() ?? {exit: 0})

    const failure = await installFailure(install.run('npm', 'react'))

    expect(failure.name).toBe('Error')
    expect(failure.frame.replace(/^\S+ /, '')).toBe(
      "Couldn't install the dependencies.\n" +
        'COMMAND npm install\n' +
        'EXIT 7\n' +
        'REASON resolving extension@latest\n' +
        'npm error code ECONNRESET\n' +
        'npm error network socket hang up\n' +
        'The new project files were removed. Fix the error above, then run ' +
        `extension create ${shellQuote(projectPath)} --template react --install again.`
    )

    // The first run's cause was recovered from, so it is not the one reported.
    expect(failure.frame).not.toContain('ETARGET')
    expect(framesIn(failure.frame)).toHaveLength(1)
    expect(install.errors).toEqual([])
    expect(install.calls.map((call) => [call.command, ...call.args])).toEqual([
      ['npm', 'install'],
      ['npm', 'install']
    ])

    const pkg = JSON.parse(
      await fsp.readFile(path.join(projectPath, 'package.json'), 'utf8')
    )
    expect(pkg.devDependencies.extension).toBe('latest')
  })
})

// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Writable} from 'node:stream'
import {codedError} from './coded-error'
import {corepackRegistryOrigin} from './corepack-registry'
import {
  isDevelopWatchRunning,
  missingDevelopBuildEntries,
  waitForDevelopBuildEntries
} from './develop-build-entries'
import {findExtensionDevelopRoot} from './develop-context'
import {classifyInstallFailure} from './install-registry-failure'
import * as messages from './messages'
import {CODES, isDebug, isMachineOutput} from './messaging'
import {
  buildExecEnv,
  buildInstallCommand,
  execInstallCommand,
  findWorkspaceMember,
  type InstallCommandError,
  installScriptSuppression,
  projectInstallTarget,
  resolvePackageManager,
  workspaceManagerOverride
} from './package-manager'
import {type AbsolutePath, needsInstall} from './paths'
import {readProjectDependencies} from './project-manifest'

// Under machine output stdout carries only the envelope, so the manager's
// progress follows the install notices to stderr.
function projectInstallTee() {
  return {
    stdout: isMachineOutput() ? process.stderr : process.stdout,
    stderr: process.stderr
  }
}

// Three waits, 35 seconds in all: long enough for a tarball that is a few
// seconds behind its packument, short enough that nobody thinks the run hung.
const INSTALL_RETRY_DELAYS_MS = [5000, 10000, 20000]

type InstallRetryOptions = {
  delaysMs?: number[]
  sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function directDependencyNames(packageJsonDir: string): string[] {
  try {
    return Object.keys(readProjectDependencies(packageJsonDir))
  } catch {
    return []
  }
}

// Runs one install command, and runs it again when the registry is the
// reason it failed. Any other failure is thrown on the first attempt.
async function installWithRegistryRetry(
  pmName: string,
  cmd: {command: string; args: string[]},
  spawnOptions: {cwd: string; env: Record<string, string>},
  directDependencies: string[],
  retry?: InstallRetryOptions
): Promise<void> {
  const delays = retry?.delaysMs ?? INSTALL_RETRY_DELAYS_MS
  const sleep = retry?.sleep ?? defaultSleep
  const attempts = delays.length + 1
  let waitedMs = 0

  for (let attempt = 1; ; attempt++) {
    try {
      await execInstallCommand(cmd.command, cmd.args, {
        ...spawnOptions,
        tee: projectInstallTee()
      })

      return
    } catch (error) {
      const failure = classifyInstallFailure(
        (error as InstallCommandError)?.output || '',
        {directDependencies}
      )

      if (failure.kind === 'release-too-young') {
        throw codedError(
          CODES.E_DEPENDENCY_INSTALL,
          messages.projectInstallReleaseTooYoung(failure, pmName)
        )
      }

      if (failure.kind === 'manager-not-downloaded') {
        // Mirrors the spawn: the same environment and the same folder.
        const origin = corepackRegistryOrigin(
          buildExecEnv() || process.env,
          spawnOptions.cwd
        )
        const ours = origin && origin.registry === failure.registry

        throw codedError(
          CODES.E_DEPENDENCY_INSTALL,
          messages.projectInstallManagerNotDownloaded(
            failure,
            pmName,
            ours ? origin.from : undefined
          )
        )
      }

      if (!failure.retry) throw installFailed(pmName, error)

      if (attempt >= attempts) {
        throw codedError(
          CODES.E_DEPENDENCY_INSTALL,
          messages.projectInstallRegistryNotReady(
            failure,
            pmName,
            attempts,
            waitedMs
          )
        )
      }

      const delayMs = delays[attempt - 1]

      console.warn(
        messages.projectInstallRetry(failure, delayMs, attempt + 1, attempts)
      )

      await sleep(delayMs)
      waitedMs += delayMs
    }
  }
}

// A second manager would build a tree the lockfile does not describe and
// install past the project's own policy, so the first failure is final.
function installFailed(pmName: string, error: unknown): Error {
  const failed = error as InstallCommandError & {code?: string}

  if (failed?.code === 'ENOENT') {
    return codedError(
      CODES.E_DEPENDENCY_INSTALL,
      messages.projectInstallManagerNotFound(pmName)
    )
  }

  return codedError(
    CODES.E_DEPENDENCY_INSTALL,
    messages.projectInstallFailed(pmName, failed?.exitCode, failed?.message)
  )
}

// CI and prebuild scripts set this once the dependencies are in place, which
// answers the same as passing --install false.
function isProjectInstallSkippedByEnv(): boolean {
  const raw = String(process.env.EXTENSION_SKIP_INSTALL ?? '')
    .trim()
    .toLowerCase()

  return raw === '1' || raw === 'true'
}

export async function ensureUserProjectDependencies(
  packageJsonDir: AbsolutePath,
  retry?: InstallRetryOptions
) {
  if (isProjectInstallSkippedByEnv()) return

  const member = findWorkspaceMember(packageJsonDir)
  if (!needsInstall(packageJsonDir, member?.root)) return

  // A member's lockfile lives at its workspace root, so the manager is read there.
  const pm =
    (member && workspaceManagerOverride(member)) ||
    resolvePackageManager({cwd: member?.root ?? packageJsonDir})
  const suppression = installScriptSuppression(pm)
  const target = projectInstallTarget(pm, packageJsonDir, member)
  const cmd = buildInstallCommand(pm, [
    'install',
    ...suppression.args,
    ...target.args
  ])

  if (suppression.args.length || Object.keys(suppression.env).length) {
    console.warn(messages.projectInstallScriptsDisabled(pm.name))
  }

  if (target.cwd !== packageJsonDir) {
    console.warn(messages.projectInstallInWorkspaceRoot(target.cwd, pm.name))
  }

  await installWithRegistryRetry(
    pm.name,
    cmd,
    {cwd: target.cwd, env: suppression.env},
    directDependencyNames(packageJsonDir),
    retry
  )
}

// Only a source checkout carries the build config. An installed copy that
// lost a file cannot rebuild, so it stops and names what is gone.
function canRebuildDevelopArtifacts(developRoot: string): boolean {
  return fs.existsSync(path.join(developRoot, 'rslib.config.ts'))
}

// A first watch build takes about fifteen seconds on a laptop, so a minute
// covers a slow machine before the wait gives up and names the files.
const WATCH_BUILD_WAIT_MS = 60000
const WATCH_BUILD_POLL_MS = 100

type DevelopArtifactsOptions = {
  watchWaitMs?: number
  watchPollMs?: number
}

// A spec run that compiled would write a dist into the checkout unasked,
// so under a test runner the compile needs this to be set to 1 or true.
export const COMPILE_IN_TESTS_ENV = 'EXTENSION_COMPILE_IN_TESTS'

function isTestRun(): boolean {
  return Boolean(
    process.env.VITEST ||
      process.env.VITEST_WORKER_ID ||
      process.env.NODE_TEST_CONTEXT ||
      process.env.JEST_WORKER_ID
  )
}

function isCompileInTestsAllowed(): boolean {
  const raw = String(process.env[COMPILE_IN_TESTS_ENV] ?? '')
    .trim()
    .toLowerCase()

  return raw === '1' || raw === 'true'
}

// Only a contributor running specs in a source checkout reads this.
function discard(): Writable {
  return new Writable({
    write(_chunk, _encoding, done) {
      done()
    }
  })
}

export async function ensureDevelopArtifacts(
  options?: DevelopArtifactsOptions
) {
  const developRoot = findExtensionDevelopRoot()
  if (!developRoot) return

  const missing = missingDevelopBuildEntries(developRoot)
  if (missing.length === 0) return

  if (!canRebuildDevelopArtifacts(developRoot)) {
    throw codedError(
      CODES.E_INTERNAL,
      messages.developArtifactsMissing(missing)
    )
  }

  // The running watch writes the missing files itself, so this waits for
  // it. A compile here would be a second build writing the same dist.
  if (isDevelopWatchRunning(developRoot)) {
    const unwritten = await waitForDevelopBuildEntries(
      developRoot,
      options?.watchWaitMs ?? WATCH_BUILD_WAIT_MS,
      options?.watchPollMs ?? WATCH_BUILD_POLL_MS
    )

    if (unwritten.length === 0) return

    throw codedError(
      CODES.E_INTERNAL,
      messages.developArtifactsMissing(unwritten, {watching: true})
    )
  }

  const pm = resolvePackageManager({cwd: developRoot})
  const command = buildInstallCommand(pm, ['run', 'compile'])
  const rebuild = [command.command, ...command.args].join(' ')
  const isAuthor = isDebug()

  if (isTestRun() && !isCompileInTestsAllowed()) {
    throw codedError(
      CODES.E_INTERNAL,
      messages.developArtifactsMissing(missing, {
        command: rebuild,
        developRoot,
        testRunOptIn: COMPILE_IN_TESTS_ENV
      })
    )
  }

  if (isAuthor) {
    console.warn(
      messages.authorInstallNotice(
        'extension-develop build artifacts (dist missing)'
      )
    )
  }

  try {
    // Quiet unless it fails: the output is kept, not printed, so a failed
    // compile shows its own error above the refusal instead of nothing.
    await execInstallCommand(
      command.command,
      command.args,
      isAuthor
        ? {cwd: developRoot, stdio: 'inherit'}
        : {cwd: developRoot, tee: {stdout: discard(), stderr: discard()}}
    )
  } catch (error) {
    const output = (error as InstallCommandError)?.output

    if (!isAuthor && output?.trim()) {
      console.error(messages.developCompileOutput(output))
    }

    throw codedError(
      CODES.E_INTERNAL,
      messages.developArtifactsMissing(missing, {command: rebuild, developRoot})
    )
  }

  // A build that exits clean and still skips an entry would fail much later.
  const stillMissing = missingDevelopBuildEntries(developRoot)

  if (stillMissing.length > 0) {
    throw codedError(
      CODES.E_INTERNAL,
      messages.developArtifactsMissing(stillMissing, {
        command: rebuild,
        developRoot
      })
    )
  }
}

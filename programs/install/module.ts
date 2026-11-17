//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import path from 'node:path'
import {
  ALL_BROWSER_TARGETS,
  BrowserCacheRootError,
  BrowserInstallBusyError,
  BrowserInstallerNotFoundError,
  BrowserInstallFailedError,
  BrowserInstallForeignFolderError,
  BrowserInstallPrivilegeError,
  BrowserInstallTimeoutError,
  BrowserNotInstallableError,
  BrowserUninstallError,
  type InstallBrowserTarget,
  isBrowserCacheRootError,
  isBrowserInstallBusyError,
  isBrowserInstallerNotFoundError,
  isBrowserInstallFailedError,
  isBrowserInstallForeignFolderError,
  isBrowserInstallPrivilegeError,
  isBrowserInstallTimeoutError,
  isBrowserNotInstallableError,
  isBrowserUninstallError,
  normalizeBrowserName,
  type UninstallOutcome,
  type UninstallResult,
  withCause
} from './lib/browser-target'

export {
  BrowserCacheRootError,
  BrowserInstallBusyError,
  BrowserInstallerNotFoundError,
  BrowserInstallFailedError,
  BrowserInstallForeignFolderError,
  BrowserInstallPrivilegeError,
  BrowserInstallTimeoutError,
  BrowserNotInstallableError,
  BrowserUninstallError,
  isBrowserCacheRootError,
  isBrowserInstallBusyError,
  isBrowserInstallerNotFoundError,
  isBrowserInstallFailedError,
  isBrowserInstallForeignFolderError,
  isBrowserInstallPrivilegeError,
  isBrowserInstallTimeoutError,
  isBrowserNotInstallableError,
  isBrowserUninstallError,
  normalizeBrowserName
}
export type {InstallBrowserTarget, UninstallOutcome, UninstallResult}
export type {LockSeams} from './lib/install-lock'

import {
  removeTree as removeTreeFromDisk,
  resolveBrowserInstallDir,
  resolveBrowsersCacheRoot
} from './lib/cache-root'
import {
  folderOwner,
  holdsNoBrowser,
  holdsOnlyMarker,
  removeMarkerOnlyFolder,
  writeInstallMarker
} from './lib/folder-owner'
import {
  acquireLock,
  acquireLockNow,
  type HeldLock,
  installLockDir,
  LockBusyError,
  type LockSeams,
  liveLockOwner,
  readLockOwner
} from './lib/install-lock'
import * as messages from './lib/messages'
import {humanLine, humanWarn} from './lib/messaging'
import {
  type CommandResult,
  detectSystemEdgeBinary,
  edgeInstallNeedsInteractivePrivilegedSession,
  type InstallPlan,
  type InstallPlanOptions,
  installTimeoutMs,
  isEdgePrivilegeEscalationFailure,
  locateSystemEdge,
  prepareInstall,
  runCommand,
  type SystemEdgeLookup
} from './lib/runner'

export interface InstallOptions extends InstallPlanOptions {
  browser: string
  // True when the caller picked the browser because the user named none, so
  // the first line can say the name was a default and not a choice.
  defaulted?: boolean
  // The executable the install left under destination, or null when nothing
  // usable is there. The launcher's resolver is the one judge of that, so the
  // caller hands it over rather than this package guessing a second time.
  locateInstalledBinary: (
    destination: string,
    browser: InstallBrowserTarget
  ) => string | null
  // Runs the package runner and reports how it ended. Left out, the real
  // runner is spawned, so only a caller that must not download passes one.
  runInstaller?: typeof runCommand
  // The surroundings an Edge install asks about, and how a tree is removed.
  // Each one left out is read from the process and the disk.
  stdinIsTTY?: boolean
  isRoot?: boolean
  systemEdge?: SystemEdgeLookup
  removeTree?: (dir: string) => void
  // The clock, the wait and the pid check of the one-install-at-a-time lock.
  lock?: LockSeams
}

export interface UninstallOptions {
  browser?: string
  all?: boolean
  // Where the cache root is read from, how a tree is removed and how a system
  // Edge is looked for. Left out, they are the process and the disk.
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  systemEdge?: SystemEdgeLookup
  removeTree?: (dir: string) => void
  lock?: LockSeams
}

export function getManagedBrowsersCacheRoot(): string {
  return resolveBrowsersCacheRoot()
}

export function getManagedBrowserInstallDir(browser: string): string {
  const target = normalizeBrowserName(browser)

  return resolveBrowserInstallDir(target)
}

function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  return text.split(/\r?\n/)[0].trim()
}

interface Discard {
  removed: boolean
  failure?: unknown
  // Why a tree that is no longer ours was left alone.
  note?: string
}

// A broken tree left behind makes the next run stack on it. Only one that is
// ours and still locked by this run goes: anything else may be someone's data.
function discardUnusableInstallTree(
  destination: string,
  target: InstallBrowserTarget,
  remove: (dir: string) => void,
  lock: HeldLock
): Discard {
  const owner = folderOwner(destination, target)

  if (owner === 'absent') return {removed: false}

  if (owner === 'foreign') {
    return {removed: false, note: messages.foreignFolderKept(destination)}
  }

  if (!lock.stillHeld()) return {removed: false}

  try {
    // The marker alone is this run's own trace, not files worth a mention.
    if (holdsOnlyMarker(destination)) {
      removeMarkerOnlyFolder(destination)

      return {removed: false}
    }

    remove(destination)

    return {removed: true}
  } catch (failure) {
    return {removed: false, failure}
  }
}

// The install failure is what the caller has to act on, so a removal that
// failed too is named behind it and carried as the cause, never thrown alone.
function withRemovalFailure<T extends Error>(
  build: (message: string) => T,
  message: string,
  destination: string,
  discard: Discard
): T {
  if (discard.note) return build(`${message} ${discard.note}`)
  if (!('failure' in discard)) return build(message)

  return withCause(
    build(`${message} ${messages.brokenTreeNotRemoved(destination)}`),
    discard.failure
  )
}

function isFolder(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function cacheRootProblem(cacheRoot: string, cause: unknown): string {
  return fs.existsSync(cacheRoot) && !isFolder(cacheRoot)
    ? 'is a file, not a folder'
    : `can't be created (${String((cause as NodeJS.ErrnoException).code)})`
}

// Asked before the first line prints, so a cache root that cannot hold a
// browser is one error and not a promise followed by a raw mkdir failure.
function planOnUsableCacheRoot(
  target: InstallBrowserTarget,
  destination: string,
  cacheRoot: string,
  options: InstallPlanOptions
): InstallPlan {
  try {
    const plan = prepareInstall(target, destination, options)

    // The lock sits beside the browser folder, so every runner needs the root.
    fs.mkdirSync(cacheRoot, {recursive: true})

    return plan
  } catch (cause) {
    throw withCause(
      new BrowserCacheRootError(
        messages.cacheRootUnusable(
          target,
          cacheRoot,
          cacheRootProblem(cacheRoot, cause)
        )
      ),
      cause
    )
  }
}

// A root that exists and still refuses the lock or the marker is named with
// the system's own code, before any installer is started.
function cacheRootUnwritable(
  target: InstallBrowserTarget,
  cacheRoot: string,
  cause: unknown
): BrowserCacheRootError {
  const code = String((cause as NodeJS.ErrnoException | null)?.code)

  return withCause(
    new BrowserCacheRootError(
      messages.cacheRootUnusable(
        target,
        cacheRoot,
        `can't be written (${code})`
      )
    ),
    cause
  )
}

function refuseForeignFolder(
  target: InstallBrowserTarget,
  destination: string
): void {
  if (folderOwner(destination, target) === 'foreign') {
    throw new BrowserInstallForeignFolderError(
      messages.foreignFolder(target, destination)
    )
  }
}

// A spawn also answers ENOENT for a working directory that is gone, which is
// not a missing runner and keeps its own error.
function isMissingRunner(error: unknown, cwd: string): boolean {
  return (
    (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' &&
    fs.existsSync(cwd)
  )
}

function dropMarkerOnlyFolder(destination: string): void {
  try {
    if (holdsOnlyMarker(destination)) removeMarkerOnlyFolder(destination)
  } catch {
    // An empty folder left behind is ours and is reused by the next run.
  }
}

interface InstallRun {
  target: InstallBrowserTarget
  destination: string
  plan: InstallPlan
  timeoutMs: number
  lock: HeldLock
  waited: boolean
  edgeLookup: SystemEdgeLookup
}

async function installUnderLock(
  {
    defaulted,
    locateInstalledBinary,
    runInstaller = runCommand,
    platform = process.platform,
    isRoot = process.getuid?.() === 0,
    removeTree = removeTreeFromDisk,
    lock: lockSeams = {}
  }: InstallOptions,
  {target, destination, plan, timeoutMs, lock, waited, edgeLookup}: InstallRun
): Promise<void> {
  refuseForeignFolder(target, destination)

  // The install this run waited for may have left the browser it wanted.
  if (waited) {
    if (locateInstalledBinary(destination, target)) {
      humanLine(messages.installSucceeded(target, destination))

      return
    }

    const present = target === 'edge' ? locateSystemEdge(edgeLookup) : null

    if (present) {
      humanLine(
        messages.edgeInstalledSystemWide(present.path, present.launcherFinds)
      )

      return
    }
  }

  const {command: cmd, args} = plan

  try {
    writeInstallMarker(destination, target, (lockSeams.now ?? Date.now)())
  } catch (error) {
    throw cacheRootUnwritable(target, path.dirname(destination), error)
  }

  humanLine(messages.installingBrowser(target, destination, Boolean(defaulted)))

  // Playwright has sudo ask for a password on the terminal, which a child in
  // its own session cannot reach, so that one installer stays attached.
  const needsTerminal = target === 'edge' && platform !== 'win32' && !isRoot
  let result: CommandResult

  try {
    result = await runInstaller(cmd, args, {
      cwd: plan.cwd,
      env: plan.env,
      timeoutMs,
      ...(needsTerminal ? {ownGroup: false} : {})
    })
  } catch (error) {
    dropMarkerOnlyFolder(destination)

    if (!isMissingRunner(error, plan.cwd)) throw error

    throw withCause(
      new BrowserInstallerNotFoundError(
        messages.installerNotFound(target, cmd)
      ),
      error
    )
  }

  if (result.code !== 0) {
    // Only a binary under destination keeps the tree. A system Edge is not in
    // it, so it is no reason to leave broken files behind.
    const discard: Discard = locateInstalledBinary(destination, target)
      ? {removed: false}
      : discardUnusableInstallTree(destination, target, removeTree, lock)

    if (result.timedOut) {
      throw withRemovalFailure(
        (message) => new BrowserInstallTimeoutError(message, timeoutMs),
        messages.installTimedOut(target, timeoutMs, discard.removed),
        destination,
        discard
      )
    }

    if (result.interrupted) {
      throw withRemovalFailure(
        (message) => new BrowserInstallFailedError(message),
        messages.installInterrupted(
          target,
          result.interrupted,
          discard.removed
        ),
        destination,
        discard
      )
    }

    if (
      target === 'edge' &&
      isEdgePrivilegeEscalationFailure(`${result.stdout}\n${result.stderr}`)
    ) {
      const installedEdge = locateSystemEdge(edgeLookup)

      if (installedEdge) {
        humanWarn(
          messages.edgeInstallUsingSystemBinary(
            installedEdge.path,
            installedEdge.launcherFinds
          )
        )

        if ('failure' in discard) {
          humanWarn(messages.brokenTreeLeftBehind(destination))
        }

        return
      }

      throw withRemovalFailure(
        (message) => new BrowserInstallPrivilegeError(message),
        platform === 'darwin'
          ? messages.edgeInstallNeedsAdministratorPassword()
          : messages.edgeInstallNeedsInteractivePrivilegedSession(),
        destination,
        discard
      )
    }

    throw withRemovalFailure(
      (message) => new BrowserInstallFailedError(message),
      messages.installFailed(target, cmd, args, result),
      destination,
      discard
    )
  }

  if (locateInstalledBinary(destination, target)) {
    humanLine(messages.installSucceeded(target, destination))

    return
  }

  // Edge's installer places the browser system-wide, so for edge the system
  // binary counts as the install. Anything else has to be under destination.
  const systemEdge = target === 'edge' ? locateSystemEdge(edgeLookup) : null

  if (systemEdge) {
    humanLine(
      messages.edgeInstalledSystemWide(
        systemEdge.path,
        systemEdge.launcherFinds
      )
    )

    return
  }

  // The installer's exit code says it finished, not that the files it left are
  // a browser. An interrupted download exits 0 with a truncated tree.
  const discard = discardUnusableInstallTree(
    destination,
    target,
    removeTree,
    lock
  )

  throw withRemovalFailure(
    (message) => new BrowserInstallFailedError(message),
    messages.installIncomplete(target, destination, discard.removed),
    destination,
    discard
  )
}

export async function extensionInstall(options: InstallOptions): Promise<void> {
  const {
    browser,
    env,
    platform,
    cwd,
    stdinIsTTY,
    isRoot = process.getuid?.() === 0,
    systemEdge,
    lock: lockSeams = {}
  } = options
  const target = normalizeBrowserName(browser)
  const cacheRoot = resolveBrowsersCacheRoot(env, platform, cwd)
  const destination = resolveBrowserInstallDir(target, cacheRoot)
  const edgeLookup = {platform, env, ...systemEdge}

  // Playwright needs sudo to prompt only when Edge is absent and the process
  // is not root, so those two are asked before the session is refused.
  if (
    target === 'edge' &&
    edgeInstallNeedsInteractivePrivilegedSession(platform, stdinIsTTY)
  ) {
    const present = locateSystemEdge(edgeLookup)

    if (present) {
      humanLine(
        messages.edgeAlreadyInstalled(present.path, present.launcherFinds)
      )

      return
    }

    if (!isRoot) {
      throw new BrowserInstallPrivilegeError(
        messages.edgeInstallNeedsInteractivePrivilegedSession()
      )
    }
  }

  const plan = planOnUsableCacheRoot(target, destination, cacheRoot, {
    env,
    platform,
    cwd
  })

  // Refused before the lock is made, so a foreign folder gains nothing new.
  refuseForeignFolder(target, destination)

  const timeoutMs = installTimeoutMs(env ?? process.env)
  const lockDir = installLockDir(cacheRoot, target)
  let held: {lock: HeldLock; waited: boolean}

  try {
    held = await acquireLock(
      lockDir,
      timeoutMs,
      (owner) =>
        humanLine(messages.waitingForInstall(target, owner?.pid ?? null)),
      lockSeams
    )
  } catch (error) {
    if (!(error instanceof LockBusyError)) {
      throw cacheRootUnwritable(target, cacheRoot, error)
    }

    throw new BrowserInstallBusyError(
      messages.installBusy(target, error.owner?.pid ?? null, timeoutMs, lockDir)
    )
  }

  const {lock, waited} = held

  // A host that calls process.exit mid-install must not leave the lock held.
  process.once('exit', lock.release)

  try {
    await installUnderLock(
      {...options, isRoot},
      {target, destination, plan, timeoutMs, lock, waited, edgeLookup}
    )
  } finally {
    process.off('exit', lock.release)
    lock.release()
  }
}

type Removal =
  | {state: 'removed' | 'none'}
  | {
      state: 'failed'
      kind: messages.UninstallFailureKind
      reason: string
      failure?: unknown
    }

// Takes the same lock an install holds, without waiting for it, and removes
// only a folder that is ours. A folder with no browser in it goes quietly.
function removeManagedFolder(
  target: InstallBrowserTarget,
  cacheRoot: string,
  remove: (dir: string) => void,
  timeoutMs: number,
  seams: LockSeams
): Removal {
  const installDir = resolveBrowserInstallDir(target, cacheRoot)
  const lockDir = installLockDir(cacheRoot, target)
  const foreign: Removal = {
    state: 'failed',
    kind: 'foreign',
    reason: messages.uninstallReasonForeign()
  }

  const installing = (): Removal => {
    const holder = readLockOwner(lockDir)

    return {
      state: 'failed',
      kind: 'installing',
      reason: messages.uninstallReasonInstalling(holder?.pid ?? null)
    }
  }

  const owner = folderOwner(installDir, target)

  if (owner === 'foreign') return foreign
  if (liveLockOwner(lockDir, seams)) return installing()
  if (owner === 'absent') return {state: 'none'}

  let lock: HeldLock | null = null

  try {
    lock = acquireLockNow(lockDir, timeoutMs, seams)

    if (!lock) return installing()

    const current = folderOwner(installDir, target)

    if (current === 'foreign') return foreign
    if (current === 'absent') return {state: 'none'}

    const browserless = holdsNoBrowser(installDir)

    remove(installDir)

    return {state: browserless ? 'none' : 'removed'}
  } catch (failure) {
    return {
      state: 'failed',
      kind: 'removal',
      reason: firstLine(failure),
      failure
    }
  } finally {
    lock?.release()
  }
}

export async function extensionUninstall({
  browser,
  all,
  env,
  platform,
  systemEdge,
  removeTree = removeTreeFromDisk,
  lock: lockSeams = {}
}: UninstallOptions): Promise<UninstallResult[]> {
  const cacheRoot = resolveBrowsersCacheRoot(env, platform)

  if (!all && !browser) {
    throw new Error(messages.uninstallRequiresTarget())
  }

  // Same comma-list rules as install: "chrome,edge" and "all" expand here so
  // the CLI and direct callers share one acceptance surface.
  const named: InstallBrowserTarget[] = all
    ? [...ALL_BROWSER_TARGETS]
    : String(browser || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((name) => normalizeBrowserName(name))
  const targets = [...new Set(named)]

  if (!all && targets.length === 0) {
    throw new Error(messages.uninstallRequiresTarget())
  }

  humanLine(messages.uninstallingBrowsers(cacheRoot, targets))

  const timeoutMs = installTimeoutMs(env ?? process.env)
  const results: UninstallResult[] = []
  const kinds: messages.UninstallFailureKind[] = []
  const failures: unknown[] = []

  // One folder that will not go must not keep the others, so each target is
  // attempted and the failures are thrown together once the walk ends.
  for (const target of targets) {
    const installDir = resolveBrowserInstallDir(target, cacheRoot)
    const removal = removeManagedFolder(
      target,
      cacheRoot,
      removeTree,
      timeoutMs,
      lockSeams
    )

    if (removal.state === 'failed') {
      kinds.push(removal.kind)
      if ('failure' in removal) failures.push(removal.failure)

      results.push({
        browser: target,
        removed: false,
        path: installDir,
        outcome: 'failed',
        reason: removal.reason
      })

      continue
    }

    if (removal.state === 'removed') {
      humanLine(messages.uninstallSucceeded(target, installDir))
      results.push({
        browser: target,
        removed: true,
        path: installDir,
        outcome: 'removed'
      })

      continue
    }

    const systemPath =
      target === 'edge'
        ? detectSystemEdgeBinary({platform, env, ...systemEdge})
        : null

    if (systemPath) {
      humanLine(messages.uninstallSkippedSystemEdge(systemPath))
      results.push({
        browser: target,
        removed: false,
        path: installDir,
        outcome: 'system',
        systemPath
      })

      continue
    }

    humanLine(messages.uninstallNoop(target, installDir))
    results.push({
      browser: target,
      removed: false,
      path: installDir,
      outcome: 'absent'
    })
  }

  if (results.some((result) => result.outcome === 'failed')) {
    throw withCause(
      new BrowserUninstallError(
        messages.uninstallFailed(results, kinds),
        results
      ),
      failures.length > 1 ? new AggregateError(failures) : failures[0]
    )
  }

  return results
}

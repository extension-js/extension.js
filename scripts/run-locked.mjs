// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

const OWNER_FILE = 'owner.json'
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_POLL_MS = 50
// A lock directory with no owner file this old lost its holder mid-acquire.
const OWNERLESS_STALE_MS = 10 * 1000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function lockDirFor(cwd, name) {
  return path.join(cwd, 'node_modules', '.cache', `${name}.lock`)
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    // EPERM means the process exists and belongs to someone else.
    return error?.code === 'EPERM'
  }
}

function readOwnerPid(lockDir) {
  try {
    const owner = JSON.parse(
      fs.readFileSync(path.join(lockDir, OWNER_FILE), 'utf8')
    )

    return Number.isInteger(owner?.pid) ? owner.pid : null
  } catch {
    return null
  }
}

function lockAgeMs(lockDir) {
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs
  } catch {
    return 0
  }
}

function isStale(lockDir) {
  const ownerPid = readOwnerPid(lockDir)

  if (ownerPid === null) return lockAgeMs(lockDir) > OWNERLESS_STALE_MS

  return !isProcessAlive(ownerPid)
}

// The rename is the atomic step: of several waiters that see the same dead
// holder, one moves the directory away and the rest get ENOENT and retry.
function removeStaleLock(lockDir, pid) {
  const graveyard = `${lockDir}.stale-${pid}-${Date.now()}`

  try {
    fs.renameSync(lockDir, graveyard)
  } catch {
    return
  }

  const movedOwner = readOwnerPid(graveyard)

  if (movedOwner !== null && isProcessAlive(movedOwner)) {
    // A new holder took the lock between the check and the rename.
    try {
      fs.renameSync(graveyard, lockDir)

      return
    } catch {
      // The path is taken again, so the moved copy is only debris.
    }
  }

  fs.rmSync(graveyard, {recursive: true, force: true})
}

export async function acquireLock(lockDir, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const pid = options.pid ?? process.pid
  const deadline = Date.now() + timeoutMs

  fs.mkdirSync(path.dirname(lockDir), {recursive: true})

  for (;;) {
    try {
      fs.mkdirSync(lockDir)
      fs.writeFileSync(
        path.join(lockDir, OWNER_FILE),
        `${JSON.stringify({pid, startedAt: new Date().toISOString()})}\n`
      )

      return
    } catch (error) {
      // Windows answers EPERM for a directory that is mid-removal.
      const held =
        error?.code === 'EEXIST' ||
        (error?.code === 'EPERM' && fs.existsSync(lockDir))

      if (!held) throw error
    }

    if (isStale(lockDir)) {
      removeStaleLock(lockDir, pid)
      continue
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the lock at ${lockDir} ` +
          `(held by pid ${readOwnerPid(lockDir) ?? 'unknown'}). ` +
          'Remove that directory if no such process is running.'
      )
    }

    await sleep(pollMs)
  }
}

export function releaseLock(lockDir, pid = process.pid) {
  if (readOwnerPid(lockDir) !== pid) return

  fs.rmSync(lockDir, {recursive: true, force: true})
}

function runShell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {stdio: 'inherit', shell: true})
    const forward = (signal) => child.kill(signal)

    process.on('SIGINT', forward)
    process.on('SIGTERM', forward)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      process.off('SIGINT', forward)
      process.off('SIGTERM', forward)
      resolve(code ?? (signal ? 1 : 0))
    })
  })
}

// Two runs of one package's compile rewrite the same dist files in place, and
// their interleaved writes leave a file holding the tail of the longer copy.
export async function runLocked(name, command, options = {}) {
  const lockDir = lockDirFor(options.cwd ?? process.cwd(), name)

  await acquireLock(lockDir, options)

  const release = () => releaseLock(lockDir)

  process.once('exit', release)

  try {
    return await runShell(command)
  } finally {
    process.off('exit', release)
    release()
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  const [name, ...commandParts] = process.argv.slice(2)
  const command = commandParts.join(' ')

  if (!name || !command) {
    console.error('Usage: node scripts/run-locked.mjs <lock-name> "<command>"')
    process.exit(2)
  }

  try {
    process.exit(await runLocked(name, command))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

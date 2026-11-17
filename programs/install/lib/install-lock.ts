//  ██╗███╗   ██╗███████╗████████╗ █████╗ ██╗     ██╗
//  ██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║     ██║
//  ██║██╔██╗ ██║███████╗   ██║   ███████║██║     ██║
//  ██║██║╚██╗██║╚════██║   ██║   ██╔══██║██║     ██║
//  ██║██║ ╚████║███████║   ██║   ██║  ██║███████╗███████╗
//  ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {InstallBrowserTarget} from './browser-target'

const OWNER_FILE = 'owner.json'
const DEFAULT_POLL_MS = 250
// A lock folder with no owner file this old lost its holder mid-acquire.
const OWNERLESS_STALE_MS = 10_000
// What a holder may still need after its own timeout: the kill and the cleanup.
const STALE_MARGIN_MS = 60_000

export interface LockSeams {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  isAlive?: (pid: number) => boolean
  pid?: number
  pollMs?: number
}

export interface LockOwner {
  pid: number
  id: string
  startedAt: string
  timeoutMs: number
}

export interface HeldLock {
  dir: string
  stillHeld: () => boolean
  release: () => void
}

// Thrown to the caller that waited the whole timeout, with the last holder
// that was read so the message can name it.
export class LockBusyError extends Error {
  readonly owner: LockOwner | null

  constructor(lockDir: string, owner: LockOwner | null) {
    super(`The lock at ${lockDir} is held.`)
    this.name = 'LockBusyError'
    this.owner = owner
  }
}

export function installLockDir(
  cacheRoot: string,
  browser: InstallBrowserTarget
): string {
  return path.join(cacheRoot, `.${browser}.lock`)
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    // EPERM means the process exists and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function readLockOwner(lockDir: string): LockOwner | null {
  try {
    const owner = JSON.parse(
      fs.readFileSync(path.join(lockDir, OWNER_FILE), 'utf8')
    ) as Partial<LockOwner> | null

    if (!owner || !Number.isInteger(owner.pid)) return null

    return {
      pid: owner.pid as number,
      id: String(owner.id || ''),
      startedAt: String(owner.startedAt || ''),
      timeoutMs: Number(owner.timeoutMs) || 0
    }
  } catch {
    return null
  }
}

function lockAgeMs(lockDir: string, now: number): number {
  try {
    return now - fs.statSync(lockDir).mtimeMs
  } catch {
    return 0
  }
}

// A live pid is not proof: the system hands a dead holder's pid to a new
// process, so a lock past its holder's own deadline is stale as well.
function isStale(lockDir: string, seams: LockSeams): boolean {
  const now = (seams.now ?? Date.now)()
  const owner = readLockOwner(lockDir)

  if (!owner) return lockAgeMs(lockDir, now) > OWNERLESS_STALE_MS
  if (!(seams.isAlive ?? isProcessAlive)(owner.pid)) return true

  const startedAt = Date.parse(owner.startedAt)

  return (
    Number.isFinite(startedAt) &&
    now - startedAt > owner.timeoutMs + STALE_MARGIN_MS
  )
}

// The rename is the atomic step: of several waiters that see the same dead
// holder, one moves the folder away and the rest get ENOENT and retry.
function removeStaleLock(lockDir: string, seams: LockSeams): boolean {
  const graveyard = `${lockDir}.stale-${seams.pid ?? process.pid}-${randomUUID()}`

  try {
    fs.renameSync(lockDir, graveyard)
  } catch {
    return !fs.existsSync(lockDir)
  }

  if (!isStale(graveyard, seams)) {
    // A new holder took the lock between the check and the rename.
    try {
      fs.renameSync(graveyard, lockDir)

      return false
    } catch {
      // The path is taken again, so the moved copy is only debris.
    }
  }

  fs.rmSync(graveyard, {recursive: true, force: true})

  return true
}

function take(
  lockDir: string,
  timeoutMs: number,
  seams: LockSeams
): HeldLock | null {
  try {
    fs.mkdirSync(lockDir)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // Windows answers EPERM for a folder that is mid-removal.
    const held =
      code === 'EEXIST' || (code === 'EPERM' && fs.existsSync(lockDir))

    if (!held) throw error

    return null
  }

  const owner: LockOwner = {
    pid: seams.pid ?? process.pid,
    id: randomUUID(),
    startedAt: new Date((seams.now ?? Date.now)()).toISOString(),
    timeoutMs
  }

  fs.writeFileSync(path.join(lockDir, OWNER_FILE), `${JSON.stringify(owner)}\n`)

  // Two installs in one process share a pid, so the id is what tells them apart.
  const stillHeld = () => readLockOwner(lockDir)?.id === owner.id

  return {
    dir: lockDir,
    stillHeld,
    release: () => {
      if (stillHeld()) fs.rmSync(lockDir, {recursive: true, force: true})
    }
  }
}

// The holder of a lock that is not stale, or null when the lock is free.
export function liveLockOwner(
  lockDir: string,
  seams: LockSeams = {}
): LockOwner | 'unknown' | null {
  if (!fs.existsSync(lockDir) || isStale(lockDir, seams)) return null

  return readLockOwner(lockDir) ?? 'unknown'
}

// One attempt, for a caller that must not wait. A stale lock is taken over.
export function acquireLockNow(
  lockDir: string,
  timeoutMs: number,
  seams: LockSeams = {}
): HeldLock | null {
  const lock = take(lockDir, timeoutMs, seams)
  if (lock) return lock

  if (isStale(lockDir, seams) && removeStaleLock(lockDir, seams)) {
    return take(lockDir, timeoutMs, seams)
  }

  return null
}

export async function acquireLock(
  lockDir: string,
  timeoutMs: number,
  onWait: (owner: LockOwner | null) => void,
  seams: LockSeams = {}
): Promise<{lock: HeldLock; waited: boolean}> {
  const now = seams.now ?? Date.now
  const sleep = seams.sleep ?? sleepFor
  const deadline = now() + timeoutMs
  let waited = false

  for (;;) {
    const lock = acquireLockNow(lockDir, timeoutMs, seams)
    if (lock) return {lock, waited}

    if (now() >= deadline) {
      throw new LockBusyError(lockDir, readLockOwner(lockDir))
    }

    if (!waited) {
      waited = true
      onWait(readLockOwner(lockDir))
    }

    await sleep(seams.pollMs ?? DEFAULT_POLL_MS)
  }
}

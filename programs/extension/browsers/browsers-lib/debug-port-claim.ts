// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {isPidAlive} from './resolve-live-pid'

export interface DebugPortClaim {
  port: number
  release(): void
}

// A claim nobody could read is a crash between creating and writing it.
const UNREADABLE_CLAIM_MAX_AGE_MS = 60_000

const heldClaims = new Set<string>()
let exitHookInstalled = false

export function debugPortClaimDir(): string {
  return path.join(os.tmpdir(), 'extension-js-debug-ports')
}

function claimPath(dir: string, port: number): string {
  return path.join(dir, `${port}.claim`)
}

function claimIsLive(file: string): boolean {
  let pid: unknown

  try {
    pid = JSON.parse(fs.readFileSync(file, 'utf-8'))?.pid
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false
  }

  if (typeof pid === 'number') return isPidAlive(pid)

  try {
    return Date.now() - fs.statSync(file).mtimeMs < UNREADABLE_CLAIM_MAX_AGE_MS
  } catch {
    return false
  }
}

// The claim of a session that died is moved aside in one rename, so two
// sessions cannot both clear it. One taken from a live owner is put back.
function clearDeadClaim(file: string): boolean {
  if (claimIsLive(file)) return false

  const aside = `${file}.${process.pid}.${Date.now()}.dead`

  try {
    fs.renameSync(file, aside)
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
  }

  const tookLiveClaim = claimIsLive(aside)

  if (tookLiveClaim) {
    try {
      fs.linkSync(aside, file)
    } catch {
      // Ignore
    }
  }

  try {
    fs.unlinkSync(aside)
  } catch {
    // Ignore
  }

  return !tookLiveClaim
}

// Creating the file fails when it exists, so of every session asking for the
// same port at the same moment exactly one gets it.
function takeClaim(file: string): boolean {
  const body = JSON.stringify({pid: process.pid, claimedAt: Date.now()})

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, body, {flag: 'wx'})

      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') return false
    }

    if (!clearDeadClaim(file)) return false
  }

  return false
}

function dropClaim(file: string) {
  if (!heldClaims.delete(file)) return

  try {
    fs.unlinkSync(file)
  } catch {
    // Ignore
  }
}

function installExitHook() {
  if (exitHookInstalled) return

  exitHookInstalled = true
  process.once('exit', () => {
    for (const file of [...heldClaims]) dropClaim(file)
  })
}

function portIsFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))

    try {
      server.listen(port, host)
    } catch {
      resolve(false)
    }
  })
}

// A browser binds its own debugging port, so the session cannot hold the
// socket for it. The claim covers the gap between the probe and that bind.
export async function claimDebugPortNear(
  startPort: number,
  options: {maxAttempts?: number; host?: string; dir?: string} = {}
): Promise<DebugPortClaim> {
  const maxAttempts = options.maxAttempts ?? 50
  const host = options.host ?? '127.0.0.1'
  const dir = options.dir ?? debugPortClaimDir()
  let claimable = true

  try {
    fs.mkdirSync(dir, {recursive: true})
  } catch {
    claimable = false
  }

  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i
    const file = claimPath(dir, port)

    if (claimable && !takeClaim(file)) continue

    if (claimable) {
      heldClaims.add(file)
      installExitHook()
    }

    // eslint-disable-next-line no-await-in-loop
    if (await portIsFree(port, host)) {
      return {port, release: () => dropClaim(file)}
    }

    dropClaim(file)
  }

  return {port: startPort, release: () => {}}
}

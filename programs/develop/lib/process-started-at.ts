// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'

const PROCESS_START_PROBE_TIMEOUT_MS = 5000

// When a process started, as ps reports it. ps prints the day and month in
// the shell's language, so it is asked in C, the one spelling Date.parse
// reads. A machine without ps, or a probe past its bound, answers undefined.
function startedAtFromProcessTable(pid = process.pid): string | undefined {
  try {
    const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: PROCESS_START_PROBE_TIMEOUT_MS,
      env: {...process.env, LC_ALL: 'C'}
    })

    if (result.error || result.status !== 0) return undefined

    const started = Date.parse(String(result.stdout || '').trim())

    return Number.isNaN(started) ? undefined : new Date(started).toISOString()
  } catch {
    return undefined
  }
}

// The same instant off this process's own clock, a few milliseconds after the
// one the process table holds.
function startedAtFromOwnClock(): string {
  return new Date(Date.now() - process.uptime() * 1000).toISOString()
}

let ownStartedAt: string | undefined

// When the writer's own process started, ISO 8601 UTC, read once: its pid
// never changes while it runs, and the contract is rewritten on every compile.
// A pid is reused once its owner exits, so a contract that names one pairs it
// with this. ps answers in milliseconds and is what a reader will ask, so it
// goes first. Windows has no ps, and dating a pid there costs a PowerShell
// start that runs past the bound on a loaded machine and would hold the first
// compile meanwhile, so a process on Windows reads its own clock, as does one
// whose ps is missing.
export function ownProcessStartedAt(): string {
  if (!ownStartedAt) {
    ownStartedAt =
      (process.platform === 'win32'
        ? undefined
        : startedAtFromProcessTable()) || startedAtFromOwnClock()
  }

  return ownStartedAt
}

// When another pid started, in epoch ms, or null when it cannot be dated.
// Windows is not asked: a PowerShell start runs past the bound on a loaded
// machine, so a reader there trusts liveness alone.
export function processStartedAtMs(pid: number): number | null {
  if (process.platform === 'win32') return null
  if (!Number.isInteger(pid) || pid <= 0) return null

  const startedAt = startedAtFromProcessTable(pid)

  return startedAt ? Date.parse(startedAt) : null
}

// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'

// A cold PowerShell CIM query can take a minute on a loaded Windows machine,
// so the answer is bounded and a slow one reads as unknown, like a failed one.
export const PROCESS_START_PROBE_TIMEOUT_MS = 5000

function runQuiet(
  bin: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): string | null {
  try {
    const result = spawnSync(bin, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: PROCESS_START_PROBE_TIMEOUT_MS,
      ...(env ? {env} : {})
    })

    if (result.error || result.status !== 0) return null

    return String(result.stdout || '')
  } catch {
    return null
  }
}

// When a pid started, as the process table reports it, ISO 8601 UTC. A pid is
// reused once its owner exits, so a contract that names one pairs it with
// this. ps prints the day and month in the shell's language, so it is asked
// in C, the one spelling Date.parse reads; PowerShell is asked for UTC. A pid
// the table cannot date, or a probe past its bound, answers undefined.
export function processStartedAt(
  pid: number | null | undefined,
  platform = process.platform
): string | undefined {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return undefined

  const output =
    platform === 'win32'
      ? runQuiet('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}")` +
            '.CreationDate.ToUniversalTime().ToString("o")'
        ])
      : runQuiet('ps', ['-o', 'lstart=', '-p', String(pid)], {
          ...process.env,
          LC_ALL: 'C'
        })

  const started = Date.parse(String(output || '').trim())

  return Number.isNaN(started) ? undefined : new Date(started).toISOString()
}

let ownStartedAt: string | undefined
let ownStartedAtRead = false

// The writer's own start, read once: its pid never changes while it runs, and
// the contract is rewritten on every compile.
export function ownProcessStartedAt(): string | undefined {
  if (!ownStartedAtRead) {
    ownStartedAtRead = true
    ownStartedAt = processStartedAt(process.pid)
  }

  return ownStartedAt
}

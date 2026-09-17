// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'

export interface ProcessRow {
  pid: number
  ppid: number
  // The command line, followed by the environment where the platform shows
  // it. A browser that relaunches itself on macOS starts with a blank argv
  // and gets its profile through XRE_PROFILE_PATH, so the environment is
  // part of what identifies the session.
  command: string
}

export type ProcessLister = () => ProcessRow[]

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(.*)$/

// Content, GPU and helper processes carry the profile path too. None of them
// is the browser, and an orphaned one must never be adopted as it.
const HELPER_PROCESS =
  /plugin-container|(^|\s)-contentproc(\s|$)|(^|\s)-childID(\s|$)|--type=/

function runQuiet(bin: string, args: string[]): string | null {
  try {
    const result = spawnSync(bin, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    })

    if (result.error || result.status !== 0) return null

    return String(result.stdout || '')
  } catch {
    return null
  }
}

// One process per line: pid, parent pid, then the command line as is.
export function parseProcessRows(output: string): ProcessRow[] {
  const rows: ProcessRow[] = []

  for (const line of String(output || '').split(/\r?\n/)) {
    const match = PS_ROW.exec(line.replace(/\r$/, ''))
    if (!match) continue

    const pid = Number(match[1])
    const ppid = Number(match[2])
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue

    rows.push({pid, ppid, command: match[3].trim()})
  }

  return rows
}

// Linux ps prints no environment, but /proc does. Only the handoff variable
// matters, so only that one is appended.
function appendLinuxProfileEnv(rows: ProcessRow[]): ProcessRow[] {
  return rows.map((row) => {
    try {
      const environ = fs.readFileSync(`/proc/${row.pid}/environ`, 'utf-8')
      const entry = environ
        .split('\0')
        .find((pair) => pair.startsWith('XRE_PROFILE_PATH='))

      return entry ? {...row, command: `${row.command} ${entry}`} : row
    } catch {
      return row
    }
  })
}

// The ps and PowerShell calls run without a shell, so no argument is ever
// interpreted. PowerShell prints the same three-column shape ps does.
export function listProcesses(platform = process.platform): ProcessRow[] {
  if (platform === 'win32') {
    const script =
      'Get-CimInstance Win32_Process | ForEach-Object { ' +
      '"$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }'
    const output = runQuiet('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script
    ])

    return output ? parseProcessRows(output) : []
  }

  if (platform === 'darwin') {
    const output = runQuiet('ps', ['-axEo', 'pid=,ppid=,command='])

    return output ? parseProcessRows(output) : []
  }

  const output = runQuiet('ps', ['-axo', 'pid=,ppid=,command='])
  const rows = output ? parseProcessRows(output) : []

  return platform === 'linux' ? appendLinuxProfileEnv(rows) : rows
}

function normalizePath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .toLowerCase()
}

// The profile has to appear as a whole argument or variable value. A bare
// substring would also match a consumer that exported the path.
function carriesProfile(command: string, profilePath: string): boolean {
  const haystack = normalizePath(command)
  const needle = normalizePath(profilePath)
  let from = 0

  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return false

    const before = at === 0 ? ' ' : haystack[at - 1]
    const after = haystack[at + needle.length] ?? ' '

    if (/[\s="']/.test(before) && /[\s"']/.test(after)) return true

    from = at + 1
  }
}

// The binary a command line runs. Browser paths carry spaces and ps prints
// them unquoted, so the cut is the first option or environment entry, not
// the first space.
export function executableOf(command: string): string {
  const trimmed = normalizePath(command).trim()

  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1)

    return end > 0 ? trimmed.slice(1, end) : trimmed
  }

  const cut = trimmed.search(/\s(-|[a-z_][a-z0-9_]*=)/)

  return cut > 0 ? trimmed.slice(0, cut) : trimmed
}

// Pick the browser process for a profile out of a process table: the same
// binary we launched, running on the same profile, and not a helper. While
// the spawned launcher lives, another such process is the one it handed the
// session to. Once the launcher is gone, the root of what is left is it.
export function findLiveBrowserPid(input: {
  profilePath: string
  binary: string
  launcherPid?: number
  rows: ProcessRow[]
}): number | null {
  const profilePath = String(input.profilePath || '').trim()
  const binary = normalizePath(input.binary).trim()
  if (!profilePath || !binary) return null

  const candidates = input.rows.filter(
    (row) =>
      executableOf(row.command) === binary &&
      carriesProfile(row.command, profilePath) &&
      !HELPER_PROCESS.test(row.command)
  )
  if (candidates.length === 0) return null

  const launcher = input.launcherPid
    ? candidates.find((row) => row.pid === input.launcherPid)
    : undefined

  if (launcher) {
    const twin = candidates.find((row) => row.pid !== launcher.pid)

    return twin ? twin.pid : launcher.pid
  }

  const pids = new Set(candidates.map((row) => row.pid))
  const roots = candidates.filter((row) => !pids.has(row.ppid))

  return (roots[0] || candidates[0]).pid
}

// Signal 0 probes without sending anything. EPERM still means the pid exists.
export function isPidAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isFinite(pid)) return false

  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as {code?: string})?.code === 'EPERM'
  }
}

// The handoff happens shortly after spawn, so poll for a few seconds and
// answer early the moment a process other than the launcher owns the profile.
// With no handoff in that window the launcher pid stands.
export async function resolveLiveBrowserPid(input: {
  profilePath: string
  binary: string
  launcherPid?: number
  list?: ProcessLister
  attempts?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<number | null> {
  const list = input.list || listProcesses
  const attempts = Math.max(1, input.attempts ?? 6)
  const intervalMs = input.intervalMs ?? 500
  // Unref'd: background polling must never hold a finished session open.
  const sleep =
    input.sleep ||
    ((ms: number) =>
      new Promise<void>((r) => {
        setTimeout(r, ms).unref?.()
      }))
  let last: number | null = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = findLiveBrowserPid({
      profilePath: input.profilePath,
      binary: input.binary,
      launcherPid: input.launcherPid,
      rows: list()
    })

    if (last && last !== input.launcherPid) return last
    if (attempt < attempts - 1) await sleep(intervalMs)
  }

  return last
}

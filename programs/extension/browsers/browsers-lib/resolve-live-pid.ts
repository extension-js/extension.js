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

function runQuiet(
  bin: string,
  args: string[],
  timeoutMs?: number,
  env?: NodeJS.ProcessEnv
): string | null {
  try {
    const result = spawnSync(bin, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      ...(timeoutMs ? {timeout: timeoutMs} : {}),
      ...(env ? {env} : {})
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

// What reading the process table asks of the machine, so a caller can stand
// in for a platform it does not run on.
export interface ProcessTableIo {
  run: (bin: string, args: string[]) => string | null
  readFile: (file: string) => string
}

const processTableIo: ProcessTableIo = {
  run: (bin, args) => runQuiet(bin, args),
  readFile: (file) => fs.readFileSync(file, 'utf-8')
}

// Linux ps prints no environment, but /proc does. Only the handoff variable
// matters, so only that one is appended.
function appendLinuxProfileEnv(
  rows: ProcessRow[],
  readFile: ProcessTableIo['readFile']
): ProcessRow[] {
  return rows.map((row) => {
    try {
      const environ = readFile(`/proc/${row.pid}/environ`)
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
export function listProcesses(
  platform = process.platform,
  io: ProcessTableIo = processTableIo
): ProcessRow[] {
  if (platform === 'win32') {
    // A type accelerator loads no module, where Get-CimInstance made
    // PowerShell discover its modules first on every start.
    const script =
      "([wmisearcher]'SELECT ProcessId, ParentProcessId, CommandLine FROM Win32_Process').Get() | ForEach-Object { " +
      '"$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }'
    const output = io.run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script
    ])

    return output ? parseProcessRows(output) : []
  }

  if (platform === 'darwin') {
    const output = io.run('ps', ['-axEo', 'pid=,ppid=,command='])

    return output ? parseProcessRows(output) : []
  }

  const output = io.run('ps', ['-axo', 'pid=,ppid=,command='])
  const rows = output ? parseProcessRows(output) : []

  return platform === 'linux' ? appendLinuxProfileEnv(rows, io.readFile) : rows
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

// How many parents up a row the ancestor sits: 1 for its child, 0 when the
// row does not descend from it. The walk is bounded, so a looped table ends.
function generationsBelow(
  row: ProcessRow,
  ancestorPid: number,
  byPid: Map<number, ProcessRow>
): number {
  let at: ProcessRow | undefined = row

  for (let depth = 1; at && depth <= byPid.size + 1; depth += 1) {
    if (at.ppid === ancestorPid) return depth

    at = byPid.get(at.ppid)
  }

  return 0
}

// Whether a candidate is the process a living launcher handed the session
// to. A browser relaunches itself as its own child, under a new command line.
// A copy of the launcher's command line is a fork of it that has not exec'd
// yet, and a process below one of its helpers is a fork of that helper. Both
// live for a moment. Windows has no fork, and its launcher stub starts the
// browser with the command line it was given.
function isHandoffOf(
  launcher: ProcessRow,
  row: ProcessRow,
  byPid: Map<number, ProcessRow>,
  platform: NodeJS.Platform
): boolean {
  const depth = generationsBelow(row, launcher.pid, byPid)

  if (depth > 1) return false

  return platform === 'win32' || row.command !== launcher.command
}

// Pick the browser process for a profile out of a process table: the same
// binary we launched, running on the same profile, and not a helper. While
// the spawned launcher lives, the session is its own unless it handed it to
// another such process. Once the launcher is gone, the root of what is left
// is it.
export function findLiveBrowserPid(input: {
  profilePath: string
  binary: string
  launcherPid?: number
  rows: ProcessRow[]
  platform?: NodeJS.Platform
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

  const byPid = new Map(input.rows.map((row) => [row.pid, row]))
  const launcher = input.launcherPid
    ? candidates.find((row) => row.pid === input.launcherPid)
    : undefined

  if (launcher) {
    const platform = input.platform ?? process.platform
    const twin = candidates.find(
      (row) =>
        row.pid !== launcher.pid && isHandoffOf(launcher, row, byPid, platform)
    )

    return twin ? twin.pid : launcher.pid
  }

  // A candidate under another one, at any depth, is that one's fork.
  const roots = candidates.filter(
    (row) =>
      !candidates.some(
        (other) =>
          other.pid !== row.pid && generationsBelow(row, other.pid, byPid) > 0
      )
  )

  return (roots[0] || candidates[0]).pid
}

// The one liveness probe of this folder. Signal 0 sends nothing: EPERM is a
// live process of another user, and only ESRCH says the pid is gone.
export function isPidAlive(pid: number | null | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as {code?: string})?.code === 'EPERM'
  }
}

// When a pid started, as the OS reports it. A pid that started after the file
// naming it was written is another process wearing a recycled number, which a
// signal-0 probe cannot tell apart from the one that is gone.
// Windows is asked through .NET, which reads the kernel's creation time for
// the one pid; a CIM query for the same value also has to reach the WMI
// service and ran past the bound on a loaded machine. A cold PowerShell start
// can still take seconds, so the answer is bounded and a slow one reads as
// unknown, like a failed one.
// ps prints the day and month in the shell's language, so it is asked in C,
// the one spelling Date.parse reads.
export const PID_START_PROBE_TIMEOUT_MS = 5000

export function pidStartedAtMs(
  pid: number | null | undefined,
  platform = process.platform,
  timeoutMs = PID_START_PROBE_TIMEOUT_MS
): number | null {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return null

  const output =
    platform === 'win32'
      ? runQuiet(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `[System.Diagnostics.Process]::GetProcessById(${pid})` +
              ".StartTime.ToUniversalTime().ToString('o')"
          ],
          timeoutMs
        )
      : runQuiet('ps', ['-o', 'lstart=', '-p', String(pid)], timeoutMs, {
          ...process.env,
          LC_ALL: 'C'
        })

  const started = Date.parse(String(output || '').trim())

  return Number.isNaN(started) ? null : started
}

// What reading a start id asks of the machine, so any host can stand in
// for Linux.
export interface StartIdReader {
  platform?: NodeJS.Platform
  readFile?: (file: string) => string
}

// The kernel's own name for one run of a pid on Linux: the boot id and the
// tick the process started on. A clock step moves every date and never this.
export function pidStartId(
  pid: number | null | undefined,
  reader: StartIdReader = {}
): string | undefined {
  if ((reader.platform ?? process.platform) !== 'linux') return undefined
  if (!pid || !Number.isInteger(pid) || pid <= 0) return undefined

  const readFile =
    reader.readFile ?? ((file: string) => fs.readFileSync(file, 'utf-8'))

  try {
    const stat = readFile(`/proc/${pid}/stat`)
    // The command name sits in parentheses and may hold any of them, so the
    // fields are counted from the last one. Start time is the 22nd.
    const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const startTicks = afterName[19]
    const bootId = readFile('/proc/sys/kernel/random/boot_id').trim()

    if (!/^\d+$/.test(String(startTicks)) || !bootId) return undefined

    return `${bootId}:${startTicks}`
  } catch {
    return undefined
  }
}

// Whether a pid is still the run a start id named, or undefined when either
// side has no id and the caller has to fall back on dates.
export function sameStartId(
  stamped: unknown,
  pid: number | null | undefined,
  startIdOf: (pid: number) => string | undefined = pidStartId
): boolean | undefined {
  if (typeof stamped !== 'string' || !stamped || !pid) return undefined

  const current = startIdOf(pid)

  return current ? current === stamped : undefined
}

// The same answer as the ISO 8601 UTC string the ready contract carries, or
// undefined when the table could not date the pid.
export function pidStartedAtIso(
  pid: number | null | undefined,
  platform = process.platform
): string | undefined {
  const started = pidStartedAtMs(pid, platform)

  return started == null ? undefined : new Date(started).toISOString()
}

// How long a browser that left cleanly may take to come back. One updated at
// launch returned 0.35 s after it left, and a Windows table read costs 1 s.
export const SUCCESSOR_GRACE_MS = 5000
export const SUCCESSOR_POLL_MS = 500

// The handoff happens shortly after spawn, so poll for a few seconds and
// answer early the moment a process other than the launcher owns the profile.
// With no handoff in that window the launcher pid stands.
export async function resolveLiveBrowserPid(input: {
  profilePath: string
  binary: string
  launcherPid?: number
  list?: ProcessLister
  platform?: NodeJS.Platform
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
      rows: list(),
      platform: input.platform
    })

    if (last && last !== input.launcherPid) return last
    if (attempt < attempts - 1) await sleep(intervalMs)
  }

  return last
}

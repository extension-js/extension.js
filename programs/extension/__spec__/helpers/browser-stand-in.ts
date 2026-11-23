import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const WINDOWS = process.platform === 'win32'
const SOURCE = path.join(__dirname, 'browser-stand-in.cs')

// What a stand-in does once spawned. With nothing set it leaves at once
// with exit code 0, and it does the same thing on every system.
export interface BrowserStandIn {
  // Printed for --version or --product-version, and then it leaves.
  version?: string
  versionExitCode?: number
  // Written at launch: its pid, and one "<pid> <arguments>" line per launch.
  pidFile?: string
  argvFile?: string
  // Starts a child of its own that never ends, records it, and waits on it.
  childPidFile?: string
  // Listens where -start-debugger-server names a port, and stays up.
  debuggerServer?: 'close' | 'garbage' | 'silent'
  // Stays up until it is killed. Without it the exit code is given at once.
  stay?: boolean
  exitCode?: number
}

// Windows runs a program by its extension, so a stand-in there ends in .exe.
function programPath(dir: string, name: string): string {
  return path.join(dir, WINDOWS && !/\.exe$/i.test(name) ? `${name}.exe` : name)
}

const quoted = (text: string) => `'${text.replace(/'/g, "'\\''")}'`

function shellScript(behavior: BrowserStandIn): string {
  const lines = ['#!/bin/sh']

  if (behavior.version !== undefined) {
    lines.push(
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    --version|--product-version)',
      `      echo ${quoted(behavior.version)}`,
      `      exit ${behavior.versionExitCode ?? 0}`,
      '      ;;',
      '  esac',
      'done'
    )
  }

  if (behavior.pidFile) lines.push(`echo $$ > ${quoted(behavior.pidFile)}`)

  if (behavior.argvFile) {
    lines.push(`echo "$$ $*" >> ${quoted(behavior.argvFile)}`)
  }

  if (behavior.childPidFile) {
    lines.push(
      'sleep 600 &',
      `echo $! > ${quoted(behavior.childPidFile)}`,
      'wait',
      'exit 0'
    )
  }

  if (behavior.stay) lines.push('exec sleep 600')

  lines.push(`exit ${behavior.exitCode ?? 0}`, '')

  return lines.join('\n')
}

// A shell cannot listen on a port, so this one stand-in is a Node script.
function debuggerScript(behavior: BrowserStandIn): string {
  return `#!/usr/bin/env node
const net = require('node:net')
const mode = ${JSON.stringify(behavior.debuggerServer)}
const version = ${JSON.stringify(behavior.version ?? null)}
const asked = process.argv.some(
  (arg) => arg === '--version' || arg === '--product-version'
)

if (version !== null && asked) {
  process.stdout.write(version + '\\n')
  process.exit(${behavior.versionExitCode ?? 0})
}

const at = process.argv.indexOf('-start-debugger-server')
const port = at >= 0 ? Number(process.argv[at + 1]) : 0

net
  .createServer((socket) => {
    socket.on('error', () => {})
    if (mode === 'close') socket.destroy()
    else if (mode === 'garbage') socket.write('xx:{}')
  })
  .listen(port, '127.0.0.1')

setInterval(() => {}, 1000)
`
}

let compiled: string | undefined

// The compiler ships with Windows, so no binary is committed or downloaded.
// It writes only the target it is given, inside the folder the spec made.
function compileOrCopy(target: string) {
  if (compiled && fs.existsSync(compiled)) {
    fs.copyFileSync(compiled, target)

    return
  }

  const windows = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const compiler = ['Framework64', 'Framework']
    .map((folder) =>
      path.join(windows, 'Microsoft.NET', folder, 'v4.0.30319', 'csc.exe')
    )
    .find((file) => fs.existsSync(file))

  if (!compiler) {
    throw new Error(
      `No csc.exe under ${windows}\\Microsoft.NET, so the browser stand-in cannot be built.`
    )
  }

  const args = [
    '/nologo',
    '/nowarn:1607',
    '/optimize+',
    `/out:${target}`,
    SOURCE
  ]
  const built = spawnSync(compiler, args, {encoding: 'utf8', windowsHide: true})

  if (built.error || built.status !== 0 || !fs.existsSync(target)) {
    // Printed as well as thrown: a job cut short prints no failure summary.
    const report = [
      'The browser stand-in did not compile.',
      `COMMAND ${compiler} ${args.join(' ')}`,
      `EXIT ${built.status} ${built.error?.message ?? ''}`.trim(),
      `STDOUT ${built.stdout}`,
      `STDERR ${built.stderr}`
    ].join('\n')

    console.error(report)

    throw new Error(report)
  }

  compiled = target
}

function confFile(behavior: BrowserStandIn): string {
  const lines: string[] = []

  for (const [key, value] of Object.entries(behavior)) {
    if (value === undefined || value === false) continue

    lines.push(`${key}=${value === true ? '1' : String(value)}`)
  }

  return `${lines.join('\n')}\n`
}

// Plants a program the product can spawn as a browser, in a folder the spec
// made, and returns its path. No real browser is involved on any system.
export function plantBrowserStandIn(
  dir: string,
  name: string,
  behavior: BrowserStandIn = {}
): string {
  const binary = programPath(dir, name)
  fs.mkdirSync(dir, {recursive: true})

  if (WINDOWS) {
    compileOrCopy(binary)
    fs.writeFileSync(`${binary}.conf`, confFile(behavior))

    return binary
  }

  fs.writeFileSync(
    binary,
    behavior.debuggerServer ? debuggerScript(behavior) : shellScript(behavior)
  )

  fs.chmodSync(binary, 0o755)

  return binary
}

// A file that passes the pin check and that the system then refuses to
// spawn: a script with no interpreter, or text named as a Windows program.
export function plantUnspawnable(dir: string, name: string): string {
  const binary = programPath(dir, name)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    binary,
    WINDOWS ? 'not a program\n' : '#!/nonexistent/interpreter\n'
  )

  fs.chmodSync(binary, 0o755)

  return binary
}

// The errno a spawn of that file carries. Windows has changed its answer
// between Node releases, so it is asked there and not assumed.
export function unspawnableErrno(binary: string): string {
  if (!WINDOWS) return 'ENOENT'

  const refusal = spawnSync(binary, [], {stdio: 'ignore', windowsHide: true})

  return String((refusal.error as NodeJS.ErrnoException | undefined)?.code)
}

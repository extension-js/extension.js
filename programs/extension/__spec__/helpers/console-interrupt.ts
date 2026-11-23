import {type ChildProcess, spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {compileWindowsProgram} from './browser-stand-in'

const SOURCE = path.join(__dirname, 'console-interrupt.cs')

// Ctrl+C for a CLI the spec started, as a terminal sends it. Windows needs
// a program on the CLI's own console, built into the folder the spec made.
export function interruptCli(child: ChildProcess, dir: string): string {
  if (!child.pid) return 'no pid'

  if (process.platform !== 'win32') {
    child.kill('SIGINT')

    return 'SIGINT'
  }

  const sender = path.join(dir, 'console-interrupt.exe')

  if (!fs.existsSync(sender)) compileWindowsProgram(SOURCE, sender)

  // This worker and its parent are named so they are never interrupted.
  const sent = spawnSync(
    sender,
    [String(child.pid), String(process.pid), String(process.ppid)],
    {encoding: 'utf8', windowsHide: true, timeout: 15_000}
  )

  return `exit ${sent.status} ${String(sent.stdout || '').trim()} ${sent.error?.message ?? ''}`.trim()
}

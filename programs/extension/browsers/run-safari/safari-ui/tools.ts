// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {spawn, spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SCRIPT_TIMEOUT_MS = 90_000

export interface SafariUiScriptResult {
  ok: boolean
  code: number | null
  output: string
}

export interface SafariUiTools {
  platform: NodeJS.Platform
  runScript(source: string): Promise<SafariUiScriptResult>
  pluginkitAdd(appexPath: string): Promise<SafariUiScriptResult>
  hostApp(): string
}

export type ScriptAnswer = Record<string, unknown> & {
  ok: boolean
  error?: string
}

export function parseScriptAnswer(output: string): ScriptAnswer | null {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed && typeof parsed === 'object') return parsed as ScriptAnswer
    } catch {}
  }

  return null
}

const ACCESSIBILITY_REFUSAL =
  /assistive access|-1719\b|-25211\b|not permitted to send keystrokes/i

export function isAccessibilityRefusal(output: string): boolean {
  return ACCESSIBILITY_REFUSAL.test(String(output || ''))
}

export function appexPathFor(appPath: string): string | null {
  const plugins = path.join(appPath, 'Contents', 'PlugIns')

  try {
    const found = fs
      .readdirSync(plugins)
      .filter((entry) => entry.endsWith('.appex'))
      .sort()

    return found.length > 0 ? path.join(plugins, found[0]) : null
  } catch {
    return null
  }
}

function runProcess(
  bin: string,
  args: string[],
  input?: string
): Promise<SafariUiScriptResult> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const child = spawn(bin, args, {stdio: ['pipe', 'pipe', 'pipe']})

    const finish = (result: SafariUiScriptResult) => {
      if (settled) return

      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        return
      }

      finish({
        ok: false,
        code: null,
        output: `${output}\n${bin} did not finish within ${SCRIPT_TIMEOUT_MS} ms`
      })
    }, SCRIPT_TIMEOUT_MS)

    child.stdout?.on('data', (chunk) => (output += String(chunk)))
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      if (/ApplePersistence=NO/.test(text)) return

      output += text
    })

    child.on('error', (error) =>
      finish({ok: false, code: null, output: `${output}${String(error)}`})
    )

    child.on('close', (code) => finish({ok: code === 0, code, output}))

    if (input !== undefined) child.stdin?.end(input)
    else child.stdin?.end()
  })
}

function parentOf(pid: number): {ppid: number; command: string} | null {
  try {
    const result = spawnSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 5000
    })
    const row = /^\s*(\d+)\s+(.*)$/.exec(String(result.stdout || '').trim())
    if (!row) return null

    return {ppid: Number(row[1]), command: row[2]}
  } catch {
    return null
  }
}

export function hostAppName(
  startPid: number = process.pid,
  lookup: (pid: number) => {ppid: number; command: string} | null = parentOf,
  env: Record<string, string | undefined> = process.env
): string {
  let pid = startPid

  for (let hops = 0; hops < 24 && pid > 1; hops += 1) {
    const parent = lookup(pid)
    if (!parent) break

    const app = /([^/]+)\.app\/Contents\/MacOS\//.exec(parent.command)
    if (app) return app[1]

    pid = parent.ppid
  }

  const fromEnv = String(env.TERM_PROGRAM || '').trim()
  if (fromEnv === 'Apple_Terminal') return 'Terminal'
  if (fromEnv === 'iTerm.app') return 'iTerm'

  return fromEnv || 'the terminal app that runs this command'
}

export function createSafariUiTools(): SafariUiTools {
  return {
    platform: process.platform,
    runScript: (source) =>
      runProcess('osascript', ['-l', 'JavaScript'], source),
    pluginkitAdd: (appexPath) => runProcess('pluginkit', ['-a', appexPath]),
    hostApp: () => hostAppName()
  }
}

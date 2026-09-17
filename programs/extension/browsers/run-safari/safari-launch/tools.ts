// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {spawn} from 'node:child_process'
import {isDebug} from '../../../helpers/messaging'
import {detectSafariToolchain, type SafariToolchain} from './toolchain'

// xcodebuild output for a full app build easily reaches megabytes; keep only a
// bounded tail so failure diagnostics stay useful without unbounded memory.
const TOOL_TAIL_LINES = 50
const TOOL_TAIL_BYTES = 8 * 1024

export function toolOutputTail(output: string): string {
  const lines = output
    .slice(-TOOL_TAIL_BYTES * 4)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
  const tail = lines.slice(-TOOL_TAIL_LINES).join('\n')

  return tail.length > TOOL_TAIL_BYTES ? tail.slice(-TOOL_TAIL_BYTES) : tail
}

export interface SafariToolResult {
  ok: boolean
  code: number | null
  // stdout and stderr interleaved in arrival order, the way a terminal shows
  // them, so a failure tail reads like the tool printed it.
  output: string
}

// Every process the packaging pipeline talks to, behind one seam. Production
// spawns the real tools; specs hand in fakes and drive the real control flow.
export interface SafariPipelineTools {
  detectToolchain(): SafariToolchain
  runConverter(args: string[]): Promise<SafariToolResult>
  runXcodebuild(args: string[]): Promise<SafariToolResult>
  openApp(target: string): Promise<SafariToolResult>
  openSafari(binary: string): Promise<SafariToolResult>
  resolvePid(bundleId: string): Promise<number | null>
  pluginkitList(): Promise<string>
}

function runTool(
  bin: string,
  args: string[],
  opts?: {quiet?: boolean}
): Promise<SafariToolResult> {
  const streamOutput = isDebug() && !opts?.quiet

  return new Promise((resolve) => {
    let output = ''
    const child = spawn(bin, args, {stdio: ['ignore', 'pipe', 'pipe']})

    const onChunk = (chunk: unknown) => {
      const text = String(chunk)
      output += text

      if (output.length > TOOL_TAIL_BYTES * 8) {
        output = output.slice(-TOOL_TAIL_BYTES * 4)
      }

      if (streamOutput) process.stdout.write(text)
    }

    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', (error) =>
      resolve({ok: false, code: null, output: `${output}${String(error)}`})
    )

    child.on('close', (code) => resolve({ok: code === 0, code, output}))
  })
}

// The pid of the app `open` just raised, found by bundle id. `open` answers
// nothing useful, so this asks the window server a moment later. Safari is the
// only browser the toolchain launches that it does not spawn itself, which is
// why every other launcher can pass `child.pid` and this one has to look it up.
//
// Without this the ready contract carries no `browserPid`, so anything that
// waits on one to attach to the session's browser has nothing to attach to.
async function resolvePidForBundle(bundleId: string): Promise<number | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pid = await new Promise<number | null>((resolve) => {
      const child = spawn('osascript', [
        '-e',
        `tell application "System Events" to get unix id of first process whose bundle identifier is "${bundleId}"`
      ])
      let out = ''
      child.stdout.on('data', (d) => (out += String(d)))
      child.on('error', () => resolve(null))
      child.on('close', () => {
        const n = Number(String(out).trim())
        resolve(Number.isFinite(n) && n > 0 ? n : null)
      })
    })
    if (pid) return pid

    await new Promise((r) => setTimeout(r, 500))
  }

  return null
}

export function createSafariTools(): SafariPipelineTools {
  return {
    detectToolchain: () => detectSafariToolchain(),
    runConverter: (args) => runTool('xcrun', args),
    runXcodebuild: (args) => runTool('xcodebuild', args),
    openApp: (target) => runTool('open', [target]),
    openSafari: (binary) => runTool('open', ['-a', binary]),
    resolvePid: (bundleId) => resolvePidForBundle(bundleId),
    pluginkitList: async () => {
      const {ok, output} = await runTool('pluginkit', ['-m'], {quiet: true})

      return ok ? output : ''
    }
  }
}

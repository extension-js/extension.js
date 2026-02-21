import path from 'node:path'
import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
import {spawn} from 'cross-spawn'
import {InstallBrowserTarget} from './browser-target'

function buildExecEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return base

  const nodeDir = path.dirname(process.execPath)
  const pathSep = path.delimiter
  const existing = base.PATH || base.Path || ''

  if (existing.includes(nodeDir)) return base

  const updated = `${nodeDir}${pathSep}${existing}`.trim()
  return {
    ...base,
    PATH: updated,
    Path: updated
  }
}

export function browserInstallCommand(_target: InstallBrowserTarget): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx'
}

export function browserInstallArgs(
  target: InstallBrowserTarget,
  destination: string
): string[] {
  if (target === 'edge') {
    return ['-y', 'playwright@latest', 'install', 'msedge']
  }

  const browserRef = target === 'chrome' ? 'chrome@stable' : target
  return [
    '-y',
    '@puppeteer/browsers@latest',
    'install',
    browserRef,
    '--path',
    destination
  ]
}

export function browserInstallEnv(
  target: InstallBrowserTarget,
  destination: string
): NodeJS.ProcessEnv {
  if (target === 'edge') {
    return {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: destination
    }
  }

  return {...process.env}
}

export async function runCommand(
  command: string,
  args: string[],
  opts: {cwd: string; env: NodeJS.ProcessEnv}
): Promise<{code: number | null; stdout: string; stderr: string}> {
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: buildExecEnv(opts.env),
    stdio: 'pipe'
  })

  let stdout = ''
  let stderr = ''

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      process.stdout.write(chunk)
    })
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      process.stderr.write(chunk)
    })
  }

  return new Promise((resolve, reject) => {
    child.on('close', (code) => resolve({code, stdout, stderr}))
    child.on('error', (error) => reject(error))
  })
}

export function edgeInstallNeedsInteractivePrivilegedSession(): boolean {
  return process.platform === 'linux' && !Boolean(process.stdin?.isTTY)
}

export function isEdgePrivilegeEscalationFailure(stderr: string): boolean {
  const text = String(stderr || '')
  return (
    /switching to root user to install dependencies/i.test(text) ||
    /sudo:\s+a password is required/i.test(text) ||
    /sudo:\s+a terminal is required/i.test(text)
  )
}

export function detectSystemEdgeBinary(): string | null {
  if (process.platform === 'darwin') {
    const macPath =
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    return fs.existsSync(macPath) ? macPath : null
  }

  if (process.platform === 'win32') {
    const result = spawnSync('where', ['msedge'], {
      stdio: 'pipe',
      encoding: 'utf8'
    })
    if ((result.status || 1) === 0) {
      const first = String(result.stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      return first || null
    }
    return null
  }

  const candidates = ['microsoft-edge-stable', 'microsoft-edge', 'msedge']
  for (const cmd of candidates) {
    const result = spawnSync('which', [cmd], {
      stdio: 'pipe',
      encoding: 'utf8'
    })
    if ((result.status || 1) === 0) {
      const found = String(result.stdout || '').trim()
      if (found) return found
    }
  }

  return null
}

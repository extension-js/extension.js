import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

export function controlTokenPath(projectPath: string): string {
  return path.resolve(projectPath, '.extension-js', 'control.token')
}

export function writeControlToken(projectPath: string): string {
  const token = crypto.randomBytes(32).toString('hex')
  const file = controlTokenPath(projectPath)

  fs.mkdirSync(path.dirname(file), {recursive: true})

  // Write then chmod: writeFileSync mode is pre-umask, so set it explicitly.
  fs.writeFileSync(file, token, {encoding: 'utf-8', mode: 0o600})

  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // best-effort on platforms without POSIX modes
  }

  return token
}

export function readControlToken(projectPath: string): string | null {
  try {
    const token = fs.readFileSync(controlTokenPath(projectPath), 'utf-8').trim()
    return token.length ? token : null
  } catch {
    return null
  }
}

export function clearControlToken(projectPath: string): void {
  try {
    fs.rmSync(controlTokenPath(projectPath), {force: true})
  } catch {
    // ignore
  }
}

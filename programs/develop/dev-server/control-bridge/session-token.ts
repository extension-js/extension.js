/**
 * Per-session eval token (SURFACE.md Slice 2 auth).
 *
 * `eval` is the one op that runs arbitrary code, so it is gated twice: the dev
 * server must be started with --allow-eval, AND the controller must present a
 * secret token. The token is written 0600 to a path OUTSIDE dist/ (never shipped
 * in a build) and read by the local CLI/controller, which run in the same
 * project. It is regenerated each run and removed on shutdown.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

/** `<projectPath>/.extension-js/control.token` — outside dist/, gitignore-able. */
export function controlTokenPath(projectPath: string): string {
  return path.resolve(projectPath, '.extension-js', 'control.token')
}

/** Generate, persist (0600), and return a fresh session token. */
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

/** Read the session token, or null if no eval-enabled session is running. */
export function readControlToken(projectPath: string): string | null {
  try {
    const token = fs.readFileSync(controlTokenPath(projectPath), 'utf-8').trim()
    return token.length ? token : null
  } catch {
    return null
  }
}

/** Best-effort removal on shutdown. */
export function clearControlToken(projectPath: string): void {
  try {
    fs.rmSync(controlTokenPath(projectPath), {force: true})
  } catch {
    // ignore
  }
}

// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  CONTROL_TOKEN_FILE_PREFIX,
  controlTokenPath,
  legacyControlTokenPath,
  sessionStateDir
} from '../../lib/session-paths'

// Eval session token, keyed per project+browser (like the control-port file):
// a single per-project slot broke concurrent chrome+chromium sessions.
export {controlTokenPath, legacyControlTokenPath}

export interface ControlTokenIo {
  rename?: (from: string, to: string) => void
}

// Windows refuses a rename onto a file a reader holds open.
const RENAME_BLOCKED_CODES = new Set(['EPERM', 'EBUSY'])

function writeTokenDirect(file: string, token: string): void {
  // Write then chmod: writeFileSync mode is pre-umask, so set it explicitly.
  fs.writeFileSync(file, token, {encoding: 'utf-8', mode: 0o600})

  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // best-effort on platforms without POSIX modes
  }
}

// The temp name is dotted so no reader scanning for the token prefix sees it.
function tempTokenPath(file: string): string {
  const unique = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`

  return path.join(path.dirname(file), `.${path.basename(file)}.${unique}.tmp`)
}

// A plain overwrite truncates first, so a reader in that instant sees an
// empty token. A rename swaps the whole file in one step.
function writeTokenWhole(
  file: string,
  token: string,
  io: ControlTokenIo
): void {
  const rename = io.rename ?? fs.renameSync
  const temp = tempTokenPath(file)

  try {
    writeTokenDirect(temp, token)
    rename(temp, file)
  } catch (error) {
    fs.rmSync(temp, {force: true})

    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (!code || !RENAME_BLOCKED_CODES.has(code)) throw error

    writeTokenDirect(file, token)
  }
}

export function writeControlToken(
  projectPath: string,
  browser: string,
  io: ControlTokenIo = {}
): string {
  const token = crypto.randomBytes(32).toString('hex')
  const file = controlTokenPath(projectPath, browser)

  fs.mkdirSync(path.dirname(file), {recursive: true})
  writeTokenWhole(file, token, io)

  // Mirror to the legacy slot so an older CLI reading control.token keeps
  // working; last writer wins, no worse than the pre-fix behavior.
  try {
    writeTokenWhole(legacyControlTokenPath(projectPath), token, io)
  } catch {
    // Ignore
  }

  return token
}

function readTokenFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf-8').trim() || null
  } catch {
    return null
  }
}

function hasAnyPerBrowserToken(projectPath: string): boolean {
  try {
    return fs
      .readdirSync(sessionStateDir(projectPath))
      .some((name) => name.startsWith(CONTROL_TOKEN_FILE_PREFIX))
  } catch {
    return false
  }
}

export function readControlToken(
  projectPath: string,
  browser: string
): string | null {
  const token = readTokenFile(controlTokenPath(projectPath, browser))
  if (token) return token

  // The shared slot is last-writer-wins across browsers, so it only speaks
  // for a layout that never wrote per-browser files (older dev servers).
  if (hasAnyPerBrowserToken(projectPath)) return null

  return readTokenFile(legacyControlTokenPath(projectPath))
}

// A fast restart writes the next session's token before this one exits,
// so a session removes only the slots that still hold its own token.
export function clearControlToken(
  projectPath: string,
  browser: string,
  ownToken: string
): void {
  const slots = [
    controlTokenPath(projectPath, browser),
    legacyControlTokenPath(projectPath)
  ]

  for (const slot of slots) {
    try {
      if (readTokenFile(slot) === ownToken) fs.rmSync(slot, {force: true})
    } catch {
      // Ignore
    }
  }
}

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
import {controlTokenPath, legacyControlTokenPath} from '../../lib/session-paths'

// Eval session token, keyed per project+browser (like the control-port file):
// a single per-project slot broke concurrent chrome+chromium sessions.
export {controlTokenPath, legacyControlTokenPath}

export function writeControlToken(
  projectPath: string,
  browser: string
): string {
  const token = crypto.randomBytes(32).toString('hex')
  const file = controlTokenPath(projectPath, browser)

  fs.mkdirSync(path.dirname(file), {recursive: true})

  // Write then chmod: writeFileSync mode is pre-umask, so set it explicitly.
  fs.writeFileSync(file, token, {encoding: 'utf-8', mode: 0o600})

  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // best-effort on platforms without POSIX modes
  }

  // Mirror to the legacy slot so an older CLI reading control.token keeps
  // working; last writer wins, no worse than the pre-fix behavior.
  try {
    fs.writeFileSync(legacyControlTokenPath(projectPath), token, {
      encoding: 'utf-8',
      mode: 0o600
    })
  } catch {
    // Ignore
  }

  return token
}

export function readControlToken(
  projectPath: string,
  browser: string
): string | null {
  for (const file of [
    controlTokenPath(projectPath, browser),
    // Older dev servers wrote only the shared slot.
    legacyControlTokenPath(projectPath)
  ]) {
    try {
      const token = fs.readFileSync(file, 'utf-8').trim()
      if (token.length) return token
    } catch {
      // Ignore
    }
  }
  return null
}

export function clearControlToken(projectPath: string, browser: string): void {
  const file = controlTokenPath(projectPath, browser)
  let token: string | null = null
  try {
    token = fs.readFileSync(file, 'utf-8').trim() || null
  } catch {
    // Ignore
  }
  try {
    fs.rmSync(file, {force: true})
  } catch {
    // Ignore
  }

  // Clear the legacy mirror only when it still holds THIS session's token,
  // a concurrent session of another browser may have re-mirrored its own.
  try {
    const legacy = legacyControlTokenPath(projectPath)
    if (token && fs.readFileSync(legacy, 'utf-8').trim() === token) {
      fs.rmSync(legacy, {force: true})
    }
  } catch {
    // Ignore
  }
}

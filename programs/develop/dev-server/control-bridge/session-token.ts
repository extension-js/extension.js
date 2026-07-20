// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import {controlTokenPath, legacyControlTokenPath} from '../../lib/session-paths'

/**
 * Eval session token, keyed per project+browser (like the control-port file).
 *
 * The token file used to be a single per-project slot: starting a second
 * browser session on the same project overwrote the first session's token,
 * and EITHER session's clean shutdown deleted the file, so eval on the
 * surviving session failed "Forbidden" despite a correct --allow-eval start.
 * Concurrent (or interleaved-shutdown) chrome+chromium sessions of one
 * project are exactly the A/B setup bug reports run.
 *
 * Paths are owned by lib/session-paths (re-exported here for the existing
 * import surface); only the token lifecycle logic lives in this file.
 */
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

  // Mirror to the legacy slot so an older CLI (which only reads
  // control.token) keeps working against a newer dev server. Last writer
  // wins there, no worse than the pre-fix behavior it exists for.
  try {
    fs.writeFileSync(legacyControlTokenPath(projectPath), token, {
      encoding: 'utf-8',
      mode: 0o600
    })
  } catch {
    // best-effort
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
      // try the next location
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
    // nothing persisted for this browser
  }
  try {
    fs.rmSync(file, {force: true})
  } catch {
    // ignore
  }

  // Clear the legacy mirror only when it still holds THIS session's token,
  // a concurrent session of another browser may have re-mirrored its own.
  try {
    const legacy = legacyControlTokenPath(projectPath)
    if (token && fs.readFileSync(legacy, 'utf-8').trim() === token) {
      fs.rmSync(legacy, {force: true})
    }
  } catch {
    // ignore
  }
}

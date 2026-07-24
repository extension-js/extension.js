// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {CDPClient} from '../cdp-client'
import {findStaleUnpackedExtensionIds} from './ownership'

// Evict any prior unpacked load of THIS project before loading the current
// build, so the profile holds exactly one copy (#49). Best-effort only.
export async function uninstallStaleUnpackedLoads(
  cdp: CDPClient,
  profilePath: string | undefined,
  outPath: string
): Promise<string[]> {
  const stale = findStaleUnpackedExtensionIds(profilePath, outPath)
  const removed: string[] = []
  for (const id of stale) {
    try {
      await cdp.sendCommand('Extensions.uninstall', {id})
      removed.push(id)
    } catch {
      // best-effort only
    }
  }
  return removed
}

// Whether the dist can ever produce a background target to observe. Themes and
// content-script-only extensions never do, so waiting for one would hang.
export function declaresBackgroundContext(outPath: string): boolean {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(outPath, 'manifest.json'), 'utf-8')
    )
    const background = manifest?.background
    if (!background || typeof background !== 'object') return false
    return Boolean(
      background.service_worker ||
        (Array.isArray(background.scripts) && background.scripts.length) ||
        background.page
    )
  } catch {
    return false
  }
}

// What the browser itself says about our dist. 'unknown' means the question
// could not be asked (old Chrome, no Extensions domain) - never a refusal.
export type LoadUnpackedOutcome =
  | {status: 'loaded'; extensionId: string}
  | {status: 'refused'; reason: string}
  | {status: 'unknown'}

// CDP failures arrive as Error(JSON.stringify({code, message})); recover the
// pair so a protocol complaint can be told apart from Chrome's own verdict.
function parseCdpError(error: unknown): {code?: number; message: string} {
  const raw = String((error as Error)?.message || error || '').trim()

  try {
    const parsed = JSON.parse(raw) as {code?: unknown; message?: unknown}
    const message = String(parsed?.message || '').trim()
    if (message) {
      return {
        code: typeof parsed.code === 'number' ? parsed.code : undefined,
        message
      }
    }
  } catch {
    // Not a JSON envelope; fall through to the raw text.
  }

  return {message: raw}
}

// -32601 (no such method) and -32602 (bad params) are us failing to ask, not
// Chrome refusing. Only a different code carries a real load verdict.
const PROTOCOL_ERROR_CODES = new Set([-32601, -32602])

async function callLoadUnpacked(
  cdp: CDPClient,
  params: Record<string, unknown>
): Promise<
  {ok: true; id: string} | {ok: false; code?: number; message: string}
> {
  try {
    const response = await cdp.sendCommand('Extensions.loadUnpacked', params)
    // Chrome answers with `id`; tolerate `extensionId` from other builds.
    const id = String(
      (response as {id?: string; extensionId?: string})?.id ||
        (response as {extensionId?: string})?.extensionId ||
        ''
    )
    return {ok: true, id}
  } catch (error) {
    return {ok: false, ...parseCdpError(error)}
  }
}

// Ask Chrome to load the dist and report what it answers. The call is
// idempotent for an already-loaded path (it returns the same id), which is why
// it doubles as the only refusal signal that works headed AND headless: the
// headed path only ever shows a native modal, and headless prints nothing.
export async function loadUnpacked(
  cdp: CDPClient,
  outPath: string
): Promise<LoadUnpackedOutcome> {
  // Chrome names the parameter `path`; retry the older `extensionPath` spelling
  // only when the first shape is rejected as malformed.
  let result = await callLoadUnpacked(cdp, {path: outPath})

  if (!result.ok && result.code === -32602) {
    result = await callLoadUnpacked(cdp, {extensionPath: outPath})
  }

  if (result.ok) {
    return result.id
      ? {status: 'loaded', extensionId: result.id}
      : {status: 'unknown'}
  }

  if (PROTOCOL_ERROR_CODES.has(result.code as number) || !result.message) {
    return {status: 'unknown'}
  }

  return {status: 'refused', reason: result.message}
}

export async function loadUnpackedIfNeeded(
  cdp: CDPClient,
  outPath: string
): Promise<string | null> {
  const outcome = await loadUnpacked(cdp, outPath)
  return outcome.status === 'loaded' ? outcome.extensionId : null
}

export function readManifestInfo(
  outPath: string
): {name?: string; version?: string} | null {
  try {
    const manifestPath = path.join(outPath, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    return {name: manifest?.name, version: manifest?.version}
  } catch {
    return null
  }
}

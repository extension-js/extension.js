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

// Evict any prior unpacked load of THIS project that the persistent profile
// auto-loaded at startup, before loading the current build, so the profile
// holds exactly one copy of the extension (#49). Best-effort: older Chrome
// without `Extensions.uninstall`, or an entry that is already gone, must never
// block or fail the launch. Returns the ids actually removed.
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

export async function loadUnpackedIfNeeded(
  cdp: CDPClient,
  outPath: string
): Promise<string | null> {
  // Attempt Extensions.loadUnpacked (best effort)
  try {
    const response = await cdp.sendCommand('Extensions.loadUnpacked', {
      extensionPath: outPath,
      options: {failOnError: false}
    })

    const id = String((response as {extensionId?: string})?.extensionId || '')
    return id || null
  } catch {
    return null
  }
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

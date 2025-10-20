import * as fs from 'fs'
import * as path from 'path'
import {CDPClient} from '../cdp-client'

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

// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {CONTROL_PORT_ASSET_NAME} from '../dev-server/control-bridge/producer-runtime'
import {
  DEV_CONTENT_SCRIPT_REGISTRY_ASSET,
  isDevContentScriptStandInAsset
} from '../plugin-reload/reload-lib/dev-content-scripts'

export const DEV_HOT_UPDATES_DIR = 'hot'

const CONTENT_SCRIPTS_DIR = 'content_scripts'

function exists(target: string): boolean {
  try {
    fs.lstatSync(target)

    return true
  } catch {
    return false
  }
}

function devContentScriptStandIns(distPath: string): string[] {
  let names: string[] = []

  try {
    names = fs
      .readdirSync(path.join(distPath, CONTENT_SCRIPTS_DIR))
      .map((name) => String(name))
  } catch {
    return []
  }

  return names
    .map((name) => `${CONTENT_SCRIPTS_DIR}/${name}`)
    .filter((name) => isDevContentScriptStandInAsset(name))
    .sort()
}

export function removeDevelopmentArtifacts(distPath: string): string[] {
  const candidates = [
    CONTROL_PORT_ASSET_NAME,
    DEV_HOT_UPDATES_DIR,
    DEV_CONTENT_SCRIPT_REGISTRY_ASSET,
    ...devContentScriptStandIns(distPath)
  ]
  const removed: string[] = []

  for (const relative of candidates) {
    const target = path.join(distPath, relative)

    if (!exists(target)) continue

    try {
      fs.rmSync(target, {recursive: true, force: true})
      removed.push(relative)
    } catch {}
  }

  return removed
}

// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {CONTROL_PORT_ASSET_NAME} from '../../dev-server/control-bridge/producer-runtime'
import {HOT_UPDATES_FOLDER} from '../../lib/hot-update-files'
import {isDevContentScriptStandInAsset} from '../../plugin-web-extension/feature-scripts/contracts'
import {DEV_CONTENT_SCRIPT_REGISTRY_ASSET} from './dev-content-scripts'

const CONTENT_SCRIPTS_DIR = 'content_scripts'

function exists(target: string): boolean {
  try {
    fs.lstatSync(target)

    return true
  } catch {
    // A path lstat cannot read is treated as absent
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
    // A build with no content scripts folder has no stand-ins
    return []
  }

  return names
    .map((name) => `${CONTENT_SCRIPTS_DIR}/${name}`)
    .filter((name) => isDevContentScriptStandInAsset(name))
    .sort()
}

export function removeDevelopmentArtifacts(distPath: string): {
  removed: string[]
  kept: string[]
} {
  const candidates = [
    CONTROL_PORT_ASSET_NAME,
    HOT_UPDATES_FOLDER,
    DEV_CONTENT_SCRIPT_REGISTRY_ASSET,
    ...devContentScriptStandIns(distPath)
  ]
  const removed: string[] = []
  const kept: string[] = []

  for (const relative of candidates) {
    const target = path.join(distPath, relative)

    if (!exists(target)) continue

    try {
      fs.rmSync(target, {recursive: true, force: true})
      removed.push(relative)
    } catch {
      // A file that cannot be removed is reported back as kept
      kept.push(relative)
    }
  }

  return {removed, kept}
}

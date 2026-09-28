// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {humanWarn, isDebug} from '../../helpers/messaging'
import {loadsExtensionsOverCdpOnly} from './browser-family'

// The bundled devtools companion reads this file beside its manifest before it
// opens any tab. The CLI writes it only into a per-session copy, never into
// the shared dist, so two sessions with different flags never see each other.
export const COMPANION_SESSION_FLAGS_FILE = 'extension-js-session.json'

const COMPANION_DIR_NAME = 'extension-js-devtools'

export interface CompanionSessionFlags {
  noOpen: boolean
}

export function isDevtoolsCompanionPath(extensionPath: string): boolean {
  return path
    .normalize(String(extensionPath || ''))
    .split(/[\\/]+/)
    .includes(COMPANION_DIR_NAME)
}

function readManifest(extensionPath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8')
    )

    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

// The companions a browser that drops --load-extension still needs over CDP:
// everything but the user dist and a theme, which such a browser refuses.
export function companionPathsForCdpLoad(
  extensionPaths: string[],
  outPath: string
): string[] {
  return extensionPaths.filter((extensionPath) => {
    if (path.resolve(extensionPath) === path.resolve(outPath)) return false

    return !readManifest(extensionPath)?.theme
  })
}

function dropNewTabOverride(extensionPath: string) {
  const manifestPath = path.join(extensionPath, 'manifest.json')
  const manifest = readManifest(extensionPath)
  if (!manifest || !('chrome_url_overrides' in manifest)) return

  delete manifest.chrome_url_overrides
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )
}

// Keeps the extension-js-devtools segment so every companion filter in the
// launchers (output path, banner, addon summary) still recognizes the copy.
export function stagedCompanionPath(
  stageRoot: string,
  companionPath: string
): string {
  return path.join(stageRoot, COMPANION_DIR_NAME, path.basename(companionPath))
}

// Under --no-open the companion must not open its welcome page or the
// extensions page. It only learns that from a flag file next to its manifest,
// so the session gets its own copy of the companion with the file written in.
// A browser that only takes extensions over CDP gets the same copy with the
// new tab override dropped, since it refuses a manifest that carries one.
// The stage root is the profile dir: a profile has exactly one browser at a
// time, so the copy is never shared and an ephemeral profile takes it along.
export function stageCompanionForSession(input: {
  extensionPaths: string[]
  noOpen?: boolean
  browser?: string
  stageRoot?: string
  provision?: boolean
}): string[] {
  const {extensionPaths} = input
  const cdpOnly = loadsExtensionsOverCdpOnly(input.browser || '')
  if ((!input.noOpen && !cdpOnly) || !input.stageRoot) return extensionPaths

  const index = extensionPaths.findIndex((p) => isDevtoolsCompanionPath(p))
  if (index === -1) return extensionPaths

  const source = extensionPaths[index]
  const staged = stagedCompanionPath(input.stageRoot, source)
  if (path.resolve(source) === path.resolve(staged)) return extensionPaths

  if (input.provision !== false) {
    try {
      fs.rmSync(staged, {recursive: true, force: true})
      fs.cpSync(source, staged, {recursive: true})
      const flags: CompanionSessionFlags = {noOpen: Boolean(input.noOpen)}
      fs.writeFileSync(
        path.join(staged, COMPANION_SESSION_FLAGS_FILE),
        `${JSON.stringify(flags)}\n`,
        'utf8'
      )

      if (cdpOnly) dropNewTabOverride(staged)
    } catch (error) {
      // Without the copy the companion loads from its shared dist and the CDP
      // close on the dev path stays the fallback, so never fail the launch.
      if (isDebug()) {
        humanWarn(
          `[browser] Could not stage the devtools companion for this session: ${
            (error as Error)?.message || String(error)
          }`
        )
      }

      return extensionPaths
    }
  }

  const next = [...extensionPaths]
  next[index] = staged

  return next
}

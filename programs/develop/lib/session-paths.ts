// ███████╗███████╗███████╗███████╗██╗ ██████╗ ███╗   ██╗      ██████╗  █████╗ ████████╗██╗  ██╗███████╗
// ██╔════╝██╔════╝██╔════╝██╔════╝██║██╔═══██╗████╗  ██║      ██╔══██╗██╔══██╗╚══██╔══╝██║  ██║██╔════╝
// ███████╗█████╗  ███████╗███████╗██║██║   ██║██╔██╗ ██║█████╗██████╔╝███████║   ██║   ███████║███████╗
// ╚════██║██╔══╝  ╚════██║╚════██║██║██║   ██║██║╚██╗██║╚════╝██╔═══╝ ██╔══██║   ██║   ██╔══██║╚════██║
// ███████║███████╗███████║███████║██║╚██████╔╝██║ ╚████║      ██║     ██║  ██║   ██║   ██║  ██║███████║
// ╚══════╝╚══════╝╚══════╝╚══════╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'

/**
 * THE owner of every on-disk session-state path. Dev sessions are
 * per project+browser, so every artifact here must embed the browser key —
 * a per-project single slot gets clobbered the moment a second browser
 * session starts on the same project (the control.token defect: session B's
 * start overwrote session A's eval token, and either shutdown deleted it
 * for both). New artifacts MUST be registered in SESSION_ARTIFACTS; the
 * layout spec fails any per-project shape that isn't an explicitly
 * allowlisted legacy slot, and a repo-scan spec fails path joins that
 * bypass this module.
 *
 * Two roots with different lifetimes:
 * - `<project>/.extension-js/` survives dist wipes. Anything a browser
 *   profile may have baked in (ports, tokens) lives here — a profile can
 *   outlive dist/, and state that dies with dist strands the profile's
 *   cached service worker (issue #484).
 * - `<project>/dist/extension-js/<browser>/` dies with dist. Machine
 *   contracts and logs that describe the CURRENT session only.
 */

export function sessionStateDir(projectPath: string): string {
  return path.resolve(projectPath, '.extension-js')
}

export function controlPortFilePath(
  projectPath: string,
  browser: string
): string {
  return path.join(sessionStateDir(projectPath), `control-port-${browser}`)
}

/** Pre-#484 location: died with dist/ while profiles outlived it. Read-only
 * fallback so a 4.0.6-era profile's cached SW can still resync. */
export function legacyControlPortFilePath(
  projectPath: string,
  browser: string
): string {
  return path.join(browserArtifactsDir(projectPath, browser), 'control-port')
}

export function controlTokenPath(
  projectPath: string,
  browser: string
): string {
  return path.join(sessionStateDir(projectPath), `control-token-${browser}`)
}

/** Pre-fix single-slot token shared by every browser session of a project. */
export function legacyControlTokenPath(projectPath: string): string {
  return path.join(sessionStateDir(projectPath), 'control.token')
}

export function browserArtifactsDir(
  projectPath: string,
  browser: string
): string {
  return path.resolve(projectPath, 'dist', 'extension-js', browser)
}

export function readyContractPath(
  projectPath: string,
  browser: string
): string {
  return path.join(browserArtifactsDir(projectPath, browser), 'ready.json')
}

export function eventsPath(projectPath: string, browser: string): string {
  return path.join(browserArtifactsDir(projectPath, browser), 'events.ndjson')
}

export function logsPath(projectPath: string, browser: string): string {
  return path.join(browserArtifactsDir(projectPath, browser), 'logs.ndjson')
}

export function actionsPath(projectPath: string, browser: string): string {
  return path.join(browserArtifactsDir(projectPath, browser), 'actions.ndjson')
}

export type SessionArtifactKeying =
  | 'per-browser'
  | 'legacy-shared'
  | 'legacy-per-browser-in-dist'

export interface SessionArtifact {
  name: string
  keying: SessionArtifactKeying
  build: (projectPath: string, browser: string) => string
}

export const SESSION_ARTIFACTS: ReadonlyArray<SessionArtifact> = [
  {name: 'control-port', keying: 'per-browser', build: controlPortFilePath},
  {
    name: 'legacy-control-port',
    keying: 'legacy-per-browser-in-dist',
    build: legacyControlPortFilePath
  },
  {name: 'control-token', keying: 'per-browser', build: controlTokenPath},
  {
    name: 'legacy-control-token',
    keying: 'legacy-shared',
    build: (projectPath) => legacyControlTokenPath(projectPath)
  },
  {name: 'ready-contract', keying: 'per-browser', build: readyContractPath},
  {name: 'events-log', keying: 'per-browser', build: eventsPath},
  {name: 'bridge-logs', keying: 'per-browser', build: logsPath},
  {name: 'actions-audit', keying: 'per-browser', build: actionsPath}
]

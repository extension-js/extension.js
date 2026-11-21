// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'

// The build engine and the CLI browser launcher both stamp ready.json and
// both find it here. The CLI bundles this file, so it imports node:path only.
export function sessionArtifactsRootDir(projectPath: string): string {
  return path.resolve(projectPath, 'dist', 'extension-js')
}

export function browserArtifactsDir(
  projectPath: string,
  browser: string
): string {
  return path.join(sessionArtifactsRootDir(projectPath), browser)
}

export function readyContractPath(
  projectPath: string,
  browser: string
): string {
  return path.join(browserArtifactsDir(projectPath, browser), 'ready.json')
}

// The launcher is handed the build folder alone. For dist/<browser> the
// sibling it names here is the project's own session root.
export function sessionArtifactsRootDirBesideBuild(buildPath: string): string {
  return path.join(path.dirname(buildPath), 'extension-js')
}

export function readyContractPathBesideBuild(buildPath: string): string {
  return path.join(
    sessionArtifactsRootDirBesideBuild(buildPath),
    path.basename(buildPath),
    'ready.json'
  )
}

type ReadyRecord = Record<string, unknown>

export interface OwedDebuggerPorts {
  rdpPort?: boolean
  cdpPort?: boolean
  // The launcher came back with nothing more to stamp. Only Chromium has
  // this way out, Firefox always names its port or the reason for none.
  launchSettled?: boolean
}

function rdpPortSettled(ready: ReadyRecord | undefined): boolean {
  return (
    typeof ready?.rdpPort === 'number' ||
    typeof ready?.rdpPortError === 'string'
  )
}

function cdpPortSettled(ready: ReadyRecord | undefined): boolean {
  return (
    typeof ready?.cdpPort === 'number' ||
    typeof ready?.cdpFaultCode === 'string'
  )
}

// A compile is not the session being ready while the launcher still owes the
// debugger port, or the fault that stands in for it.
export function owedPortsSettled(
  ready: ReadyRecord | undefined,
  owed: OwedDebuggerPorts
): boolean {
  return (
    (!owed.rdpPort || rdpPortSettled(ready)) &&
    (!owed.cdpPort || owed.launchSettled === true || cdpPortSettled(ready))
  )
}

export function isDevSessionStarting(ready: ReadyRecord): boolean {
  return ready.command === 'dev' && ready.status === 'starting'
}

// Only dev holds a finished compile at starting. A start or preview record
// is turned ready by its own launch phase, never by this rule.
export function heldReadyCanRelease(
  ready: ReadyRecord,
  owed: OwedDebuggerPorts = {}
): boolean {
  return (
    isDevSessionStarting(ready) &&
    typeof ready.compiledAt === 'string' &&
    !ready.code &&
    typeof ready.awaitingExecutorSince !== 'string' &&
    owedPortsSettled(ready, owed)
  )
}

export function releaseHeldReady(
  ready: ReadyRecord,
  owed: OwedDebuggerPorts = {}
): boolean {
  if (!heldReadyCanRelease(ready, owed)) return false

  ready.status = 'ready'

  return true
}

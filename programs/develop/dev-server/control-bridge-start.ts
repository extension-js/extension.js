// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {humanLine} from '../lib/messaging'
import {ensureSessionStateIgnoreFile} from '../lib/session-paths'
import type {BridgeBroker} from './control-bridge/broker'
import {CONTROL_WS_PATH} from './control-bridge/contracts'
import {
  controlPortFilePath,
  legacyControlPortFilePath,
  readPersistedControlPort,
  writePersistedControlPort
} from './control-bridge/control-port-store'
import {startControlServer} from './control-bridge/ws-control-server'
import * as messages from './messages'

interface OpenControlBridgeOptions {
  broker: BridgeBroker
  host: string
  viewerOrigin: string | null
  packageJsonDir: string
  browserName: string
  logFile: {start(): void; close(): void}
  actionsFile?: {start(): void}
  print?: (line: string) => void
  startServer?: typeof startControlServer
}

interface ControlBridgeOpening {
  controlPort: number | null
  unavailableReason: string | null
  // Closes the control server, for a session that ends without a process exit.
  close: () => Promise<void>
}

// Where the control channel listens, or why it does not. One object feeds
// the compiler's contract writer and the session's, so they cannot differ.
export function controlCoordinatesOf(
  opening: Pick<ControlBridgeOpening, 'controlPort' | 'unavailableReason'>
) {
  return {
    controlPort: opening.controlPort,
    controlPortUnavailableReason: opening.unavailableReason,
    controlPath: CONTROL_WS_PATH
  }
}

export async function openControlBridge(
  options: OpenControlBridgeOptions
): Promise<ControlBridgeOpening> {
  const {broker, packageJsonDir, browserName} = options
  const print = options.print ?? humanLine
  const startServer = options.startServer ?? startControlServer
  let controlPort: number | null = null

  try {
    options.logFile.start()
    options.actionsFile?.start()

    // Prefer the previous session's port: a reused profile may still run a CACHED
    // SW with it baked in, and only a reachable server can tell it to resync.
    const controlPortFile = controlPortFilePath(packageJsonDir, browserName)
    const preferredControlPort =
      readPersistedControlPort(controlPortFile) ??
      // Pre-fix sessions persisted the port under dist/; honor it once so a
      // profile whose cached SW has that port baked in can still resync.
      readPersistedControlPort(
        legacyControlPortFilePath(packageJsonDir, browserName)
      )

    let controlServer: Awaited<ReturnType<typeof startControlServer>>

    try {
      controlServer = await startServer({
        broker,
        host: options.host,
        port: preferredControlPort ?? 0,
        viewerOrigin: options.viewerOrigin
      })
    } catch (error) {
      if (preferredControlPort == null) throw error

      controlServer = await startServer({
        broker,
        host: options.host,
        viewerOrigin: options.viewerOrigin
      })
    }

    controlPort = controlServer.port
    ensureSessionStateIgnoreFile(packageJsonDir)
    writePersistedControlPort(controlPortFile, controlServer.port)

    return {
      controlPort,
      unavailableReason: null,
      close: () => controlServer.close()
    }
  } catch (error) {
    // No control port means no reload transport at all, so say it here rather
    // than let the broker blame a worker that was never given a port to dial.
    const reason = error instanceof Error ? error.message : String(error)

    broker.noteControlPortUnavailable(reason)
    print(messages.controlBridgeUnavailable(reason))

    try {
      options.logFile.close()
    } catch {
      // Ignore
    }

    return {controlPort, unavailableReason: reason, close: async () => {}}
  }
}

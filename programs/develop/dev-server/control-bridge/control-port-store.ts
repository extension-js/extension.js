// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'

/**
 * Control-port persistence, the reachability half of stale-SW self-healing.
 *
 * Chrome caches an extension's background service-worker script per profile:
 * after a dev-server restart, a reused profile can keep running a SW whose
 * baked control port belongs to the PREVIOUS session. With an ephemeral port
 * per session that stale SW dials a dead port forever and no reload can reach
 * it. Persisting the port per project+browser lets the stale producer reach
 * the NEW server, whose broker then tells it to full-reload itself (see
 * BridgeBroker.onHello).
 *
 * The file lives under the project's `.extension-js/` dir (with the control
 * token), NOT under dist/: profiles can outlive dist/, an explicit
 * `--profile <path>` or a kept managed profile survives a dist wipe, and a
 * port file that dies with dist strands the profile's cached SW on a dead
 * port with no resync path (issue #484: permanent "no executor connected"
 * against a live, awake SW). The port must live at least as long as any
 * profile that may have it baked in.
 *
 * Paths are owned by lib/session-paths (re-exported here for the existing
 * import surface); only the read/write logic lives in this file.
 */
export {
  controlPortFilePath,
  legacyControlPortFilePath
} from '../../lib/session-paths'

export function readPersistedControlPort(filePath: string): number | null {
  try {
    const port = parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10)
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
  } catch {
    return null
  }
}

export function writePersistedControlPort(
  filePath: string,
  port: number
): void {
  try {
    fs.mkdirSync(path.dirname(filePath), {recursive: true})
    fs.writeFileSync(filePath, `${port}\n`)
  } catch {
    // Best-effort: without persistence the next session simply picks an
    // ephemeral port (pre-existing behavior).
  }
}

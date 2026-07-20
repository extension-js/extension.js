// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// Persist the control port per project+browser in .extension-js/, NOT dist/:
// a profile's cached SW may dial a stale baked port after restart (issue #484).
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

import * as fs from 'fs'
import * as path from 'path'

/**
 * Control-port persistence — the reachability half of stale-SW self-healing.
 *
 * Chrome caches an extension's background service-worker script per profile:
 * after a dev-server restart, a reused profile can keep running a SW whose
 * baked control port belongs to the PREVIOUS session. With an ephemeral port
 * per session that stale SW dials a dead port forever and no reload can reach
 * it. Persisting the port per project+browser lets the stale producer reach
 * the NEW server, whose broker then tells it to full-reload itself (see
 * BridgeBroker.onHello).
 *
 * The file lives under dist/extension-js/<browser>/ — the same dist/ that
 * holds the browser profile. Wiping dist/ wipes both, so a fresh profile
 * (no staleness possible) is exactly when a fresh port is acceptable.
 */
export function controlPortFilePath(
  packageJsonDir: string,
  browser: string
): string {
  return path.join(
    packageJsonDir,
    'dist',
    'extension-js',
    browser,
    'control-port'
  )
}

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

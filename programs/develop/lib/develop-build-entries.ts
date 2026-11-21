// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// The build config pulls in the bundler, so the runtime keeps its own copy
// of the entry names. A spec fails when the two lists stop matching.
export const DEVELOP_BUILD_ENTRIES: readonly string[] = [
  'module',
  'preview',
  'bridge',
  'ensure-hmr-for-scripts',
  'feature-scripts-content-script-wrapper',
  'feature-scripts-classic-concat-loader',
  'feature-scripts-native-geturl-import-loader',
  'feature-scripts-classic-traced-globals-loader',
  'css-parse-guard-loader',
  'dead-css-url-loader',
  'sfc-style-block-loader',
  'late-css-import-loader',
  'unplaced-style-import-loader',
  'public-css-url-loader',
  'preprocessor-passthrough-loader',
  'solid-jsx-gate-loader',
  'env-write-loader',
  'minimum-script-file',
  'page-socket-client',
  'solid-jsx-runtime',
  'main-world-bridge',
  'minimum-chromium-file',
  'minimum-firefox-file',
  'contracts'
]

export function developBuildEntryFile(developRoot: string, entry: string) {
  return path.join(developRoot, 'dist', `${entry}.mjs`)
}

export function missingDevelopBuildEntries(developRoot: string): string[] {
  return DEVELOP_BUILD_ENTRIES.map((entry) =>
    developBuildEntryFile(developRoot, entry)
  ).filter((file) => !fs.existsSync(file))
}

// The watch script holds this lock while it runs, and its first build wipes
// dist before it writes it. A compile started then would write dist with it.
export function developWatchLockDir(developRoot: string) {
  return path.join(developRoot, 'node_modules', '.cache', 'watch.lock')
}

export function isDevelopWatchRunning(developRoot: string): boolean {
  try {
    const owner = JSON.parse(
      fs.readFileSync(
        path.join(developWatchLockDir(developRoot), 'owner.json'),
        'utf8'
      )
    )

    if (!Number.isInteger(owner?.pid) || owner.pid <= 0) return false

    process.kill(owner.pid, 0)

    return true
  } catch (error) {
    // EPERM means the process exists and belongs to someone else.
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

export async function waitForDevelopBuildEntries(
  developRoot: string,
  timeoutMs: number,
  pollMs: number
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const missing = missingDevelopBuildEntries(developRoot)
    if (missing.length === 0 || Date.now() >= deadline) return missing

    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

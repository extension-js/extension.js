// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'

export type PinnedBinaryProblem = 'missing' | 'not-executable'

// A pin the user typed is checked before any spawn, so a file the system
// will not run is refused as a bad value and not reported as a launch.
export function pinnedBinaryProblem(
  binaryPath: string | null | undefined
): PinnedBinaryProblem | null {
  if (!binaryPath) return 'missing'

  let stat: fs.Stats

  try {
    stat = fs.statSync(binaryPath)
  } catch {
    return 'missing'
  }

  if (stat.isDirectory()) {
    // A macOS app bundle is a directory that the launchers resolve inside.
    return /\.app\/?$/i.test(binaryPath) ? null : 'not-executable'
  }

  if (process.platform === 'win32') return null

  try {
    fs.accessSync(binaryPath, fs.constants.X_OK)

    return null
  } catch {
    return 'not-executable'
  }
}

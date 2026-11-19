// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import type {CompilationLike} from '../../browsers-types'

// A compile that names no output folder: the build a Chromium launch loads
// and the session root its profile sits in are read from this one path.
export function defaultChromiumOutputPath(): string {
  return path.resolve(process.cwd(), 'dist', 'chrome')
}

export function getExtensionOutputPath(
  compilation: CompilationLike | undefined,
  loadExtensionFlag: string | undefined
) {
  if (!loadExtensionFlag) {
    return (
      (compilation?.options?.output?.path as string) ||
      defaultChromiumOutputPath()
    )
  }

  const entries = loadExtensionFlag
    .replace('--load-extension=', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Prefer the user extension by excluding built-in devtools/theme folders,
  // then pick the last remaining entry (user extension is appended last).
  const userCandidates = entries.filter(
    (p) =>
      !/[\\/]extension-js-devtools[\\/]/.test(p) &&
      !/[\\/]extension-js-theme[\\/]/.test(p)
  )

  return (userCandidates.length ? userCandidates : entries).slice(-1)[0]
}

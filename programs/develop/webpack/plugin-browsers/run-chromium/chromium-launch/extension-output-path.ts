// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import type {Compilation} from '@rspack/core'

/**
 * Derive the user extension output path from `--load-extension=...` flags.
 *
 * Kept in a standalone module so run-only preview can reuse it without
 * importing CDP/WS-related code paths.
 */
export function getExtensionOutputPath(
  compilation: Compilation | undefined,
  loadExtensionFlag: string | undefined
) {
  if (!loadExtensionFlag) {
    return (
      (compilation?.options?.output?.path as string) ||
      path.join(process.cwd(), 'dist')
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
      !/[\\\/]extension-js-devtools[\\\/]/.test(p) &&
      !/[\\\/]extension-js-theme[\\\/]/.test(p)
  )

  return (userCandidates.length ? userCandidates : entries).slice(-1)[0]
}


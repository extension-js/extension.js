// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {
  isDir,
  isValidExtensionRoot,
  normalizeCompanionConfig,
  toAbs
} from './utils'
import type {CompanionExtensionsConfig} from './types'

// Resolve companion extension directories that should be loaded by the browser runner.
// We assume each directory is already an unpacked extension root
export function resolveCompanionExtensionDirs(opts: {
  projectRoot: string
  config?: CompanionExtensionsConfig
}): string[] {
  const {projectRoot, config} = opts

  const normalized = normalizeCompanionConfig(config)
  const explicitPaths = normalized.paths
  const scanDir = normalized.dir

  const found: string[] = []

  // Explicit paths first (stable order)
  for (const p of explicitPaths) {
    const abs = toAbs(projectRoot, p)
    if (isValidExtensionRoot(abs)) found.push(abs)
  }

  // Scan a directory for <dir>/*/manifest.json (one level deep)
  if (scanDir) {
    const absScan = toAbs(projectRoot, scanDir)

    if (isDir(absScan)) {
      let entries: fs.Dirent[] = []
      try {
        entries = fs.readdirSync(absScan, {withFileTypes: true})
      } catch {
        entries = []
      }

      const scanOneLevel = (rootDir: string) => {
        let dirEntries: fs.Dirent[] = []

        try {
          dirEntries = fs.readdirSync(rootDir, {withFileTypes: true})
        } catch {
          dirEntries = []
        }

        for (const ent of dirEntries) {
          if (!ent.isDirectory()) continue
          if (ent.name.startsWith('.')) continue

          const candidate = path.join(rootDir, ent.name)
          if (isValidExtensionRoot(candidate)) found.push(candidate)
        }
      }

      scanOneLevel(absScan)

      if (path.basename(absScan) === 'extensions') {
        for (const ent of entries) {
          if (!ent.isDirectory()) continue
          if (ent.name.startsWith('.')) continue

          const browserDir = path.join(absScan, ent.name)
          scanOneLevel(browserDir)
        }
      }
    }
  }

  // De-dupe while preserving order
  const unique: string[] = []
  const seen = new Set<string>()

  for (const p of found) {
    if (seen.has(p)) continue

    seen.add(p)
    unique.push(p)
  }

  return unique
}

// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {CompanionExtensionsConfig} from './types'
import {
  companionFolderMatchesBrowser,
  isBrowserNamedCompanionFolder,
  isDir,
  isValidExtensionRoot,
  normalizeCompanionConfig,
  toAbs
} from './utils'

// Resolve companion extension directories that should be loaded by the browser runner.
// We assume each directory is already an unpacked extension root
export function resolveCompanionExtensionDirs(opts: {
  projectRoot: string
  config?: CompanionExtensionsConfig
  browser?: string
}): string[] {
  const {projectRoot, config, browser} = opts

  const normalized = normalizeCompanionConfig(config)
  const explicitPaths = normalized.paths
  const scanDir = normalized.dir

  const found: string[] = []

  for (const p of explicitPaths) {
    const abs = toAbs(projectRoot, p)
    if (isValidExtensionRoot(abs)) found.push(abs)
  }

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

      // Browser-named subfolders (extensions/chrome/<ext>) get one more
      // level for ANY configured dir, not only the default 'extensions'
      // basename; isValidExtensionRoot keeps arbitrary nesting out. A folder
      // named for another browser is that browser's set, not this session's.
      for (const ent of entries) {
        if (!ent.isDirectory()) continue
        if (ent.name.startsWith('.')) continue
        if (
          browser &&
          isBrowserNamedCompanionFolder(ent.name) &&
          !companionFolderMatchesBrowser(ent.name, browser)
        ) {
          continue
        }

        const browserDir = path.join(absScan, ent.name)
        scanOneLevel(browserDir)
      }
    }
  }

  const unique: string[] = []
  const seen = new Set<string>()

  for (const p of found) {
    if (seen.has(p)) continue

    seen.add(p)
    unique.push(p)
  }

  return unique
}

// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {recordCodedWarning} from '../../lib/coded-warnings'
import {CODES} from '../../lib/messaging'
import {isInsidePath, isSamePath} from '../../lib/real-path'
import {scannedCompanionOutsideProject} from '../messages'
import type {CompanionExtensionsConfig} from './types'
import {
  companionFolderMatchesBrowser,
  isBrowserNamedCompanionFolder,
  isDirExactCase,
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
  manifestPath?: string
  // Set by a caller that goes on to launch a browser with the result: an
  // entry left out is then said here, and nowhere when no browser runs.
  launchesBrowser?: boolean
}): string[] {
  const {projectRoot, config, browser, manifestPath} = opts
  // The folder holding the project's own manifest is the extension being
  // built, never a companion to load beside it.
  const ownRoot = manifestPath ? path.resolve(path.dirname(manifestPath)) : ''

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

    if (isDirExactCase(absScan)) {
      let entries: fs.Dirent[] = []

      try {
        entries = fs.readdirSync(absScan, {withFileTypes: true})
      } catch {
        entries = []
      }

      const saidOutside = new Set<string>()

      // A folder, or a link whose real path is a folder inside the project.
      // A link that leads out is left out and said once, and one that leads
      // to nothing, to a file or back to itself is no folder at all.
      const isScannedFolder = (rootDir: string, ent: fs.Dirent): boolean => {
        if (ent.isDirectory()) return true
        if (!ent.isSymbolicLink()) return false

        const candidate = path.join(rootDir, ent.name)
        let target = ''

        try {
          target = fs.realpathSync(candidate)

          if (!fs.statSync(target).isDirectory()) return false
        } catch {
          return false
        }

        if (isInsidePath(projectRoot, target)) return true
        if (isSamePath(projectRoot, target)) return false
        if (saidOutside.has(candidate)) return false

        saidOutside.add(candidate)

        if (opts.launchesBrowser) {
          const text = scannedCompanionOutsideProject(
            `./${path.relative(projectRoot, candidate).replace(/\\/g, '/')}`,
            target
          )

          recordCodedWarning(CODES.E_COMPANION_EXTENSION_PATH, text)
          console.warn(text)
        }

        return false
      }

      const scanOneLevel = (rootDir: string) => {
        let dirEntries: fs.Dirent[] = []

        try {
          dirEntries = fs.readdirSync(rootDir, {withFileTypes: true})
        } catch {
          dirEntries = []
        }

        for (const ent of dirEntries) {
          if (ent.name.startsWith('.')) continue
          if (!isScannedFolder(rootDir, ent)) continue

          const candidate = path.join(rootDir, ent.name)
          if (ownRoot && isSamePath(candidate, ownRoot)) continue
          if (isValidExtensionRoot(candidate)) found.push(candidate)
        }
      }

      scanOneLevel(absScan)

      // Browser-named subfolders (extensions/chrome/<ext>) get one more
      // level for ANY configured dir, not only the default 'extensions'
      // basename; isValidExtensionRoot keeps arbitrary nesting out. A folder
      // named for another browser is that browser's set, not this session's.
      for (const ent of entries) {
        if (ent.name.startsWith('.')) continue
        if (!isScannedFolder(absScan, ent)) continue

        if (
          browser &&
          isBrowserNamedCompanionFolder(ent.name) &&
          !companionFolderMatchesBrowser(ent.name, browser)
        ) {
          continue
        }

        const browserDir = path.join(absScan, ent.name)
        // A folder accepted as an extension root is one companion; a built
        // copy inside it (dist/manifest.json) is the same extension again.
        if (isValidExtensionRoot(browserDir)) continue

        scanOneLevel(browserDir)
      }
    }
  }

  return withoutNestedRoots(found)
}

function withoutNestedRoots(found: string[]): string[] {
  const unique: string[] = []
  const seen = new Set<string>()

  // A folder a link also reaches is one extension, loaded once.
  for (const p of found) {
    let real = p

    try {
      real = fs.realpathSync(p)
    } catch {
      real = p
    }

    if (seen.has(real)) continue

    seen.add(real)
    unique.push(p)
  }

  return unique.filter(
    (dir) => !unique.some((other) => other !== dir && isInside(dir, other))
  )
}

function isInside(dir: string, parent: string): boolean {
  return isInsidePath(parent, dir)
}

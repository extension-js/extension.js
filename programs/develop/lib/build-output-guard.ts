// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as messages from './messages'
import {humanLine} from './messaging'
import {getDirs} from './paths'
import type {ProjectStructure} from './project'
import {isSameOrInsidePath} from './real-path'
import {sessionArtifactsRootDir} from './session-paths'

type ProtectedFolderKind = 'project' | 'cwd' | 'home' | 'session-state'

// A build replaces its output folder whole. These are the folders that must
// never be that output: the ones that are, or hold, what the user works in.
export function protectedFolderAt(
  target: string,
  projectRoot: string,
  options: {cwd?: boolean; replaced?: boolean} = {}
): ProtectedFolderKind | undefined {
  if (isSameOrInsidePath(target, projectRoot)) return 'project'

  if (options.cwd !== false && isSameOrInsidePath(target, process.cwd())) {
    return 'cwd'
  }

  const home = os.homedir()

  if (home && isSameOrInsidePath(target, home)) return 'home'

  const sessionState = sessionArtifactsRootDir(projectRoot)

  if (isSameOrInsidePath(sessionState, target)) return 'session-state'

  // A folder the build empties takes the session state inside it along.
  if (options.replaced !== false && isSameOrInsidePath(target, sessionState)) {
    return 'session-state'
  }

  return undefined
}

// The only folder a build may replace is one an earlier build wrote, and
// every build writes a manifest at its root. An empty folder holds nothing.
export function holdsForeignFiles(target: string): boolean {
  if (!fs.existsSync(target)) return false
  if (fs.existsSync(path.join(target, 'manifest.json'))) return false

  try {
    return fs.readdirSync(target).length > 0
  } catch {
    return true
  }
}

function isBuildFolder(target: string): boolean {
  return fs.existsSync(path.join(target, 'manifest.json'))
}

// Output once landed beside a manifest found below the named folder. Only a
// folder holding what a build writes counts, so a source `dist` is not named.
function leftoverOutputFolder(struct: ProjectStructure): string | undefined {
  if (!struct.projectRoot) return undefined

  const {manifestDir, packageJsonDir} = getDirs(struct)
  const leftover = path.join(manifestDir, 'dist')

  if (path.resolve(leftover) === path.resolve(packageJsonDir, 'dist')) {
    return undefined
  }

  try {
    const wroteHere = fs
      .readdirSync(leftover, {withFileTypes: true})
      .some(
        (entry) =>
          entry.isDirectory() &&
          (entry.name === 'extension-js' ||
            isBuildFolder(path.join(leftover, entry.name)))
      )

    return wroteHere ? leftover : undefined
  } catch {
    return undefined
  }
}

const announcedLeftovers = new Set<string>()

// The old folder is never deleted here: it can hold a zip someone kept. One
// line per run says it is stale, since build and preview both pass this way.
export function announceLeftoverOutputFolder(struct: ProjectStructure): void {
  const leftover = leftoverOutputFolder(struct)

  if (!leftover || announcedLeftovers.has(leftover)) return

  announcedLeftovers.add(leftover)
  humanLine(
    messages.leftoverOutputFolder(
      leftover,
      path.join(getDirs(struct).packageJsonDir, 'dist')
    )
  )
}

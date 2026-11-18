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
import {isSameOrInsidePath} from './real-path'
import {sessionArtifactsRootDir} from './session-paths'

export type ProtectedFolderKind = 'project' | 'cwd' | 'home' | 'session-state'

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

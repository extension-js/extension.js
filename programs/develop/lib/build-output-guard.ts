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
  options: {cwd?: boolean} = {}
): ProtectedFolderKind | undefined {
  if (isSameOrInsidePath(target, projectRoot)) return 'project'

  if (options.cwd !== false && isSameOrInsidePath(target, process.cwd())) {
    return 'cwd'
  }

  const home = os.homedir()

  if (home && isSameOrInsidePath(target, home)) return 'home'

  if (isSameOrInsidePath(sessionArtifactsRootDir(projectRoot), target)) {
    return 'session-state'
  }

  return undefined
}

// Outside the project the only folder a build may replace is one an earlier
// build wrote, and every build writes a manifest at its root.
export function holdsForeignFiles(
  target: string,
  projectRoot: string
): boolean {
  if (isSameOrInsidePath(projectRoot, target)) return false
  if (!fs.existsSync(target)) return false

  return !fs.existsSync(path.join(target, 'manifest.json'))
}

// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {ensureDependencies} from './ensure-dependencies'
import {getDirs} from './paths'
import {
  preflightOptionalDependencies,
  shouldRunOptionalPreflight
} from './preflight-optional-deps'
import type {ProjectStructure} from './project'
import type {DevOptions} from '../webpack-types'

export async function ensureProjectReady(
  projectStructure: ProjectStructure,
  mode: DevOptions['mode'],
  opts?: {
    skipProjectInstall?: boolean
    exitOnInstall?: boolean
    showRunAgainMessage?: boolean
  }
): Promise<{
  installed: boolean
  installedBuild: boolean
  installedUser: boolean
}> {
  const {packageJsonDir} = getDirs(projectStructure)
  const result = await ensureDependencies(packageJsonDir, opts)

  if (shouldRunOptionalPreflight(projectStructure)) {
    await preflightOptionalDependencies(projectStructure, mode, {
      exitOnInstall: opts?.exitOnInstall
    })
  }

  return result
}

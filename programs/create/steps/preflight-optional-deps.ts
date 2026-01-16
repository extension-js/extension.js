//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {createRequire} from 'module'

type PreflightFn = (projectPath: string, mode?: 'development') => Promise<void>

export async function preflightOptionalDependenciesForCreate(
  projectPath: string
) {
  try {
    const requireFromProject = createRequire(
      path.join(projectPath, 'package.json')
    )
    const develop = requireFromProject('extension-develop') as {
      preflightOptionalDependenciesForProject?: PreflightFn
    }
    const preflight = develop?.preflightOptionalDependenciesForProject
    if (typeof preflight === 'function') {
      await preflight(projectPath, 'development')
    }
  } catch {
    // Best-effort: optional deps should not block project creation.
  }
}

//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {findNearestProjectManifestDirSync} from './project-manifest'

export function getUserTypeScriptConfigFile(projectPath: string) {
  // The project root is the same fallback writeTsConfig uses. A manifest-only
  // project has no package.json to sit beside, so without it the scaffold is
  // written and then never found again: TypeScript detection stays false and
  // the .ts source reaches the JS parser as 'const declarations must be
  // initialized'.
  const searchDirs = [
    findNearestProjectManifestDirSync(projectPath, 6),
    projectPath
  ]

  for (const dir of searchDirs) {
    if (!dir) continue

    const tsconfigPath = path.join(dir, 'tsconfig.json')
    if (fs.existsSync(tsconfigPath)) return tsconfigPath
  }

  return undefined
}

// A JavaScript project keeps its path aliases in jsconfig.json, which the
// resolver reads like a tsconfig. It earns no TypeScript scaffold or parser.
export function getUserJsConfigFile(projectPath: string) {
  const searchDirs = [
    findNearestProjectManifestDirSync(projectPath, 6),
    projectPath
  ]

  for (const dir of searchDirs) {
    if (!dir) continue

    const jsconfigPath = path.join(dir, 'jsconfig.json')
    if (fs.existsSync(jsconfigPath)) return jsconfigPath
  }

  return undefined
}

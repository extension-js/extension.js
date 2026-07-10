import {hasProjectDependency} from './project-manifest'

/**
 * True when `packageName` is declared by the project's manifest: package.json
 * dependency fields (dependencies, devDependencies, optionalDependencies,
 * peerDependencies) or a deno.json(c) `npm:` import.
 */
export function hasDependency(
  projectPath: string,
  packageName: string
): boolean {
  return hasProjectDependency(projectPath, packageName)
}

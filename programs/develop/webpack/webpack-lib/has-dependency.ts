import * as fs from 'fs'
import * as path from 'path'

/**
 * True when `packageName` is listed in the project's package.json dependency
 * fields (dependencies, devDependencies, optionalDependencies, or peerDependencies).
 */
export function hasDependency(
  projectPath: string,
  packageName: string
): boolean {
  const manifestPath = path.join(projectPath, 'package.json')
  if (!fs.existsSync(manifestPath)) return false

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8')
    const pkg = JSON.parse(raw || '{}') as Record<string, unknown>
    const sections = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.optionalDependencies,
      pkg.peerDependencies
    ]
    return sections.some(
      (s) => s && typeof s === 'object' && packageName in (s as object)
    )
  } catch {
    return false
  }
}

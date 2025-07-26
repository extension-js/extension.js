import * as path from 'path'
import * as fs from 'fs'
import {findUp} from 'find-up'

export async function findNearestPackageJson(
  manifestPath: string
): Promise<string | null> {
  try {
    const manifestDir = path.dirname(manifestPath)
    const packageJsonPath = await findUp('package.json', {
      cwd: manifestDir,
      type: 'file'
    })

    return packageJsonPath || null
  } catch (error) {
    console.warn('Failed to find package.json:', error)
    return null
  }
}

export function validatePackageJson(packageJsonPath: string): boolean {
  try {
    if (!fs.existsSync(packageJsonPath)) {
      return false
    }

    const content = fs.readFileSync(packageJsonPath, 'utf-8')
    JSON.parse(content)
    return true
  } catch (error) {
    console.warn('Invalid package.json at:', packageJsonPath, error)
    return false
  }
}

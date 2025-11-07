import * as path from 'path'
import * as fs from 'fs'

export function hasDependency(projectPath: string, dependency: string) {
  const findNearestPackageJsonDirectory = (
    startPath: string
  ): string | undefined => {
    let currentDirectory = startPath
    const maxDepth = 4
    for (let i = 0; i < maxDepth; i++) {
      const candidate = path.join(currentDirectory, 'package.json')
      if (fs.existsSync(candidate)) return currentDirectory
      const parentDirectory = path.dirname(currentDirectory)
      if (parentDirectory === currentDirectory) break
      currentDirectory = parentDirectory
    }
    return undefined
  }

  const packageJsonDirectory = findNearestPackageJsonDirectory(projectPath)
  if (!packageJsonDirectory) return false

  const packageJsonPath = path.join(packageJsonDirectory, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return false

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  return !!dependencies[dependency] || !!devDependencies[dependency]
}

export function isUsingJSFramework(projectPath: string): boolean {
  const frameworks = [
    'react',
    'vue',
    '@angular/core',
    'svelte',
    'solid-js',
    'preact'
  ]
  return frameworks.some((fw) => hasDependency(projectPath, fw))
}

import path from 'path'
import fs from 'fs'

export function isUsingTypeScript(projectDir: string) {
  const packageJsonPath = path.join(projectDir, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)

  const TypeScriptAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.typescript
  const TypeScriptAsDep =
    packageJson.dependencies && packageJson.dependencies.typescript

  return !!(TypeScriptAsDevDep || TypeScriptAsDep)
}

export default {
  isUsingTypeScript
}

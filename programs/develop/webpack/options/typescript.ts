// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {isUsingReact} from './react'

export function getTypeScriptConfigFile(projectDir: string) {
  const configFile = path.join(projectDir, 'tsconfig.json')

  if (fs.existsSync(configFile)) return configFile

  return undefined
}

export function getTypeScriptConfigOverrides(projectDir: string, opts: any) {
  return {
    compilerOptions: {
      // treat JS like raw web extensions do
      isolatedModules: false,
      sourceMap: opts.mode === 'development',
      inlineSourceMap: false,
      declarationMap: false,
      incremental: true,
      skipLibCheck: true,
      // TODO: this is possibly false
      noEmit: true,
      module: 'esnext',
      target: 'es2021',
      allowJs: true,
      forceConsistentCasingInFileNames: true,
      jsx: isUsingReact(projectDir) ? 'react' : 'preserve',
      tsBuildInfoFile: path.resolve(
        fs.realpathSync(projectDir),
        'node_modules',
        '.cache',
        'tsbuildinfo'
      )
    }
  }
}

export function isUsingTypeScript(projectDir: string) {
  const packageJsonPath = path.join(projectDir, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getTypeScriptConfigFile(projectDir)
  const packageJson = require(packageJsonPath)

  const TypeScriptAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.typescript
  const TypeScriptAsDep =
    packageJson.dependencies && packageJson.dependencies.typescript

  return !!configFile && !!(TypeScriptAsDevDep || TypeScriptAsDep)
}

export function tsCheckerOptions(projectDir: string) {
  return {
    typescript: {
      context: projectDir,
      configFile: getTypeScriptConfigFile(projectDir),
      configOverwrite: getTypeScriptConfigOverrides(projectDir, {
        mode: 'development'
      }),
      typescriptPath: require.resolve('typescript', {paths: [projectDir]}),
      // Measures and prints timings related to the TypeScript performance.
      profile: false
    }
  }
}

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
      moduleResolution: 'node', // Use Node's module resolution algorithm; useful if using npm packages
      lib: ['esnext', 'dom'], // Include typings for latest ECMAScript features and DOM APIs
      strict: true, // Enable all strict type-checking options
      esModuleInterop: true, // Enables emit interoperability between CommonJS and ES Modules
      allowSyntheticDefaultImports: true, // Allow default imports from modules with no default export
      noEmitOnError: true, // Do not emit outputs if any errors were reported
      resolveJsonModule: true, // Allow importing '.json' files
      // TODO: cezaraugusto check
      // isolatedModules: true, // Ensure each file can be safely transpiled without relying on other imports
      isolatedModules: false,
      sourceMap: opts.mode === 'development', // Generate source maps for debugging
      inlineSourceMap: false,
      declarationMap: false,
      incremental: true,
      skipLibCheck: true, // Skip type checking of all declaration files (*.d.ts)
      noEmit: true,
      module: 'esnext', // Use ES modules, which are the standard in modern browsers
      target: 'esnext', // Use the latest ECMAScript version for the target output
      allowJs: true,
      forceConsistentCasingInFileNames: true,
      jsx: isUsingReact(projectDir) ? 'react' : 'preserve',
      tsBuildInfoFile: path.resolve(
        fs.realpathSync(projectDir),
        'node_modules',
        '.cache',
        'tsbuildinfo'
      )
    },
    exclude: ['node_modules', 'dist']
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

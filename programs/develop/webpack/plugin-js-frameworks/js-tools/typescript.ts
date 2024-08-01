// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {isUsingReact} from './react'
import {isUsingPreact} from './preact'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'
import {DevOptions} from '../../../commands/dev'

let userMessageDelivered = false

export function isUsingTypeScript(projectPath: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getUserTypeScriptConfigFile(projectPath)
  const packageJson = require(packageJsonPath)
  const manifest = require(path.join(projectPath, 'manifest.json'))

  const TypeScriptAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.typescript
  const TypeScriptAsDep =
    packageJson.dependencies && packageJson.dependencies.typescript

  if (!userMessageDelivered) {
    if (TypeScriptAsDevDep || TypeScriptAsDep) {
      if (configFile) {
        console.log(messages.isUsingTechnology(manifest, 'TypeScript'))
      } else {
        console.log(messages.creatingTSConfig(manifest))
        writeTsConfig(projectPath)
      }
    }

    userMessageDelivered = true
  }

  return !!configFile && !!(TypeScriptAsDevDep || TypeScriptAsDep)
}

export function defaultTypeScriptConfig(projectPath: string, _opts?: any) {
  return {
    compilerOptions: {
      // Allow JavaScript files to be imported inside your project,
      // instead of just .ts and .tsx files
      allowJs: true,
      // Allow default imports from modules with no default export
      allowSyntheticDefaultImports: true,
      // Enables emit interoperability between CommonJS and ES Modules
      esModuleInterop: true,
      // Issue an error if a program tries to include a file by a casing
      // different from the casing on disk.
      forceConsistentCasingInFileNames: true,
      // Report errors on unused local variables.
      // inlineSources: false,
      // Controls how JSX constructs are emitted in JavaScript files.
      // This only affects output of JS files that started in .tsx files.
      jsx:
        isUsingReact(projectPath) || isUsingPreact(projectPath)
          ? 'react-jsx'
          : 'preserve',
      // Include typings for latest ECMAScript features and DOM APIs
      lib: ['dom', 'dom.iterable', 'esnext'],
      // Use Node's module resolution algorithm; useful if using
      // npm packages
      moduleResolution: 'node',
      // Use ES modules, which are the standard in modern browsers
      module: 'esnext',
      // Report errors on unused local variables.
      // noUnusedLocals: false,
      // Report errors on unused parameters in functions.
      // noUnusedParameters: false,
      // Allow importing '.json' files
      resolveJsonModule: true,
      // Enable all strict type-checking options
      strict: true,
      // Use the latest ECMAScript version for the target output
      target: 'esnext',
      // Ensure each file can be safely transpiled without relying
      // on other imports
      isolatedModules: false,
      skipLibCheck: true
    },
    exclude: ['node_modules', 'dist']
  }
}

export function getUserTypeScriptConfigFile(projectPath: string) {
  const configFile = path.join(projectPath, 'tsconfig.json')

  if (fs.existsSync(configFile)) return configFile

  return undefined
}

export function getTypeScriptConfigOverrides(projectPath: string, opts: any) {
  return {
    compilerOptions: {
      // Generate source maps for debugging
      sourceMap: opts.mode === 'development',
      // Skip type checking of all declaration files (*.d.ts)
      skipLibCheck: true,
      // Whether to embed the source map content in the .js files.
      inlineSourceMap: false,
      // Generates a source map for .d.ts files which map back to the
      // original .ts source file.
      declarationMap: false,
      // Do not emit compiler output files like JavaScript source code,
      // source-maps or declarations.
      noEmit: true,
      // Tells TypeScript to save information about the project graph
      // from the last compilation to files stored on disk.
      incremental: true,
      // This setting lets you specify a file for storing incremental
      // compilation information as a part of composite projects which
      // enables faster building of larger TypeScript codebases.
      tsBuildInfoFile: path.join('./', 'node_modules', '.cache', 'tsbuildinfo')
    },
    exclude: ['node_modules', 'dist']
  }
}

function writeTsConfig(projectPath: string) {
  fs.writeFileSync(
    path.join(projectPath, 'tsconfig.json'),
    JSON.stringify(
      defaultTypeScriptConfig(projectPath, {mode: 'development'}),
      null,
      2
    )
  )
}

export function tsCheckerOptions(projectPath: string, opts: any) {
  return {
    async: opts.mode === 'development',
    typescript: {
      context: projectPath,
      configFile: getUserTypeScriptConfigFile(projectPath),
      configOverwrite: getTypeScriptConfigOverrides(projectPath, {
        mode: 'development'
      }),
      typescriptPath: require.resolve('typescript', {paths: [projectPath]}),
      // Measures and prints timings related to the TypeScript performance.
      profile: false
    },
    logger: {
      log: () => {},
      error: console.error
    }
  }
}

export async function maybeUseTypeScript(
  projectPath: string,
  mode: DevOptions['mode']
): Promise<boolean> {
  if (!isUsingTypeScript(projectPath)) return false

  try {
    require.resolve('typescript')
  } catch (e) {
    const typescriptDependencies = ['typescript']

    await installOptionalDependencies('TypeScript', typescriptDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('TypeScript'))
    process.exit(0)
  }

  return true
}

// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import path from 'path'
import fs from 'fs'
import {isUsingReact} from './react'
import {bold, blue, yellow} from '@colors/colors/safe'
import {isUsingPreact} from './preact'

export function defaultTypeScriptConfig(projectDir: string, _opts?: any) {
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
        isUsingReact(projectDir) || isUsingPreact(projectDir)
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
      isolatedModules: false
    },
    exclude: ['node_modules', 'dist']
  }
}

export function getUserTypeScriptConfigFile(projectDir: string) {
  const configFile = path.join(projectDir, 'tsconfig.json')

  if (fs.existsSync(configFile)) return configFile

  return undefined
}

export function getTypeScriptConfigOverrides(projectDir: string, opts: any) {
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

function writeTsConfig(projectDir: string) {
  fs.writeFileSync(
    path.join(projectDir, 'tsconfig.json'),
    JSON.stringify(
      defaultTypeScriptConfig(projectDir, {mode: 'development'}),
      null,
      2
    )
  )
}

let userMessageDelivered = false

export function isUsingTypeScript(projectDir: string) {
  const packageJsonPath = path.join(projectDir, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getUserTypeScriptConfigFile(projectDir)
  const packageJson = require(packageJsonPath)
  const manifest = require(path.join(projectDir, 'manifest.json'))

  const TypeScriptAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.typescript
  const TypeScriptAsDep =
    packageJson.dependencies && packageJson.dependencies.typescript

  if (!userMessageDelivered) {
    if (TypeScriptAsDevDep || TypeScriptAsDep) {
      if (configFile) {
        console.log(
          bold(
            `🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${
              manifest.version
            }) `
          ) + `is using ${bold(blue('TypeScript'))} config file.`
        )
      } else {
        console.log(
          bold(
            `🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${
              manifest.version
            }) `
          ) +
            `is using ${bold(
              blue('TypeScript')
            )} but no config file was found. Creating ${yellow(
              'tsconfig.json'
            )}...`
        )

        writeTsConfig(projectDir)
      }
    }

    userMessageDelivered = true
  }

  return !!configFile && !!(TypeScriptAsDevDep || TypeScriptAsDep)
}

export function tsCheckerOptions(projectDir: string, opts: any) {
  return {
    async: opts.mode === 'development',
    typescript: {
      context: projectDir,
      configFile: getUserTypeScriptConfigFile(projectDir),
      configOverwrite: getTypeScriptConfigOverrides(projectDir, {
        mode: 'development'
      }),
      typescriptPath: require.resolve('typescript', {paths: [projectDir]}),
      // Measures and prints timings related to the TypeScript performance.
      profile: false
    },
    logger: {
      log: () => {},
      error: console.error
    }
  }
}

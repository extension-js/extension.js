// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import * as messages from '../../../webpack/lib/messages'
import {
  installOptionalDependencies,
  isUsingJSFramework
} from '../../../webpack/lib/utils'
import {type DevOptions} from '../../../commands/commands-lib/config-types'

let userMessageDelivered = false

export function isUsingTypeScript(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const configFile = getUserTypeScriptConfigFile(projectPath)
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

  const TypeScriptAsDevDep = packageJson.devDependencies?.typescript
  const TypeScriptAsDep = packageJson.dependencies?.typescript

  if (!userMessageDelivered) {
    if (TypeScriptAsDevDep || TypeScriptAsDep) {
      if (configFile) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log(messages.isUsingIntegration('TypeScript'))
        }
      } else {
        console.log(messages.creatingTSConfig())
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
      jsx: isUsingJSFramework(projectPath) ? 'react-jsx' : 'preserve',
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

export function getTypeScriptConfigOverrides(opts: {mode: DevOptions['mode']}) {
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

export async function maybeUseTypeScript(
  projectPath: string
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

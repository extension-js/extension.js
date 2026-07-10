//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import colors from 'pintor'
import * as messages from '../js-frameworks-lib/messages'
import {isUsingJSFramework} from '../frameworks-lib/integrations'
import {type DevOptions} from '../../types'
import {ensureOptionalContractPackageResolved} from '../../lib/optional-deps-resolver'

let hasShownUserMessage = false

import {
  findNearestProjectManifestDirSync,
  hasProjectDependency
} from '../../lib/project-manifest'

function findNearestPackageJsonDirectory(
  startPath: string
): string | undefined {
  return findNearestProjectManifestDirSync(startPath, 6)
}

function hasTypeScriptSourceFiles(projectPath: string): boolean {
  try {
    const entries = fs.readdirSync(projectPath, {withFileTypes: true})

    return entries.some((entry) => {
      if (entry.isFile()) {
        const name = entry.name

        if (!/\.(ts|tsx|mts|mtsx)$/i.test(name)) return false
        if (/\.(d\.ts|d\.mts|d\.mtsx)$/i.test(name)) return false
        if (/\.(spec|test)\.(ts|tsx|mts|mtsx)$/i.test(name)) return false

        return true
      }

      if (entry.isDirectory()) {
        if (!['src', 'content', 'sidebar', 'background'].includes(entry.name))
          return false
        const sub = path.join(projectPath, entry.name)
        return hasTypeScriptSourceFiles(sub)
      }
      return false
    })
  } catch {
    return false
  }
}

function hasTypeScriptDependency(projectPath: string): boolean {
  const manifestDirectory = findNearestPackageJsonDirectory(projectPath)
  if (!manifestDirectory) return false

  return hasProjectDependency(manifestDirectory, 'typescript')
}

export function isUsingTypeScript(projectPath: string): boolean {
  const tsConfigFilePath = getUserTypeScriptConfigFile(projectPath)
  if (!tsConfigFilePath) return false
  return (
    hasTypeScriptDependency(projectPath) ||
    hasTypeScriptSourceFiles(projectPath)
  )
}

export function ensureTypeScriptConfig(projectPath: string): void {
  if (hasShownUserMessage) return

  const tsConfigFilePath = getUserTypeScriptConfigFile(projectPath)
  const hasDep = hasTypeScriptDependency(projectPath)
  const hasTsFiles = hasTypeScriptSourceFiles(projectPath)

  if (hasDep || hasTsFiles) {
    if (tsConfigFilePath) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('TypeScript')}`
        )
      }
    } else if (hasTsFiles) {
      throw new Error(
        '[Extension.js] Missing tsconfig.json next to package.json. Create one to use TypeScript.'
      )
    } else {
      console.log(messages.creatingTSConfig())
      writeTsConfig(projectPath)
    }
  }

  hasShownUserMessage = true
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
  const pkgDir = findNearestPackageJsonDirectory(projectPath)
  if (pkgDir) {
    const tsconfigPath = path.join(pkgDir, 'tsconfig.json')
    if (fs.existsSync(tsconfigPath)) return tsconfigPath
  }

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

  await ensureOptionalContractPackageResolved({
    contractId: 'typescript',
    projectPath,
    dependencyId: 'typescript'
  })

  return true
}

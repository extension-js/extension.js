//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import colors from 'pintor'
import type {DevOptions} from '../../types'
import {isUsingJSFramework} from '../frameworks-lib/integrations'
import * as messages from '../js-frameworks-lib/messages'

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

export function defaultTypeScriptConfig(projectPath: string, _opts?: unknown) {
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
      // Resolve the way the bundler does. 'node' (aka node10) was REMOVED in
      // TypeScript 7, scaffolding it made the generated tsconfig fail the
      // user's own `tsc --noEmit` with TS5108, and 'bundler' is the accurate
      // model for the Rspack/SWC pipeline anyway. Matches every template.
      moduleResolution: 'bundler',
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

  // No `typescript` package is required to build a TypeScript extension:
  // sources are compiled by swc (this flag only selects the swc parser
  // syntax), and the classic-concat loader now strips types with swc too.
  // Demanding the package here used to be harmless only because
  // extension-develop shipped its own copy; once that 24MB dependency went
  // away, the check would have hard-failed every project that uses TypeScript
  // without declaring it: 112 of 902 (12.4%) of the real-world corpus.
  // Whether to install `typescript` for editor tooling and `tsc --noEmit` is
  // the project's call, not ours.
  return true
}

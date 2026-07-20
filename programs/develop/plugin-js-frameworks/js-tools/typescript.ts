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
      allowJs: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      jsx: isUsingJSFramework(projectPath) ? 'react-jsx' : 'preserve',
      lib: ['dom', 'dom.iterable', 'esnext'],
      // 'node' (aka node10) resolution was removed in TypeScript 7 and fails
      // `tsc --noEmit` with TS5108; 'bundler' models the Rspack/SWC pipeline.
      moduleResolution: 'bundler',
      module: 'esnext',
      resolveJsonModule: true,
      strict: true,
      target: 'esnext',
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
      sourceMap: opts.mode === 'development',
      skipLibCheck: true,
      inlineSourceMap: false,
      declarationMap: false,
      noEmit: true,
      incremental: true,
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

  // No `typescript` package is required to build: swc compiles the sources.
  // Installing it for editor tooling and `tsc --noEmit` is the project's call.
  return true
}

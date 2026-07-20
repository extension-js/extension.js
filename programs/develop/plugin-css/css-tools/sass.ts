//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as path from 'node:path'
import colors from 'pintor'

const cjsRequire = createRequire(import.meta.url)

import {resolveDevelopInstallRoot} from '../../lib/develop-context'
import {hasDependency} from '../../lib/has-dependency'
import type {AnyModule} from '../../lib/optional-deps-resolver'
import {ensureOptionalContractPackageResolved} from '../../lib/optional-deps-resolver'
import * as messages from '../css-lib/messages'

let userMessageDelivered = false

export function isUsingSass(projectPath: string): boolean {
  if (hasDependency(projectPath, 'sass')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('⏵⏵⏵ Author says')} ${messages.isUsingIntegration('SASS')}`
        )
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

/**
 * Resolve the Sass implementation from the user's project first, then fall back
 * to the Extension.js cache/runtime. This mirrors the PostCSS/Tailwind
 * resolution strategy so we don't depend on Node resolving `sass` from the
 * loader path inside the npx cache.
 */
export function resolveSassImplementation(
  projectPath: string
): AnyModule | undefined {
  const extensionRoot = resolveDevelopInstallRoot()
  const bases = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]

  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      let mod = req('sass')

      if (mod && typeof mod === 'object' && 'default' in mod) {
        mod = (mod as {default: AnyModule}).default
      }

      return mod
    } catch {
      // Try next base
    }
  }

  try {
    // Fallback to the Extension.js own optional dependency installation.
    // This is primarily for npm/npx usage where we install SASS into the
    // extension-develop cache directory.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let mod = cjsRequire('sass')

    if (mod && typeof mod === 'object' && 'default' in mod) {
      mod = (mod as {default: AnyModule}).default
    }

    return mod
  } catch {
    return undefined
  }
}

export function createSassLoaderOptions(
  projectPath: string,
  mode: 'development' | 'production'
): Record<string, AnyModule> {
  const implementation = resolveSassImplementation(projectPath)
  const usingSass = isUsingSass(projectPath)

  // Project declares "sass" but we cannot resolve any implementation from
  // the project or extension runtime – surface a clear error.
  if (usingSass && !implementation) {
    throw new Error(messages.missingSassDependency())
  }

  const base: Record<string, AnyModule> = {
    sourceMap: mode === 'development',
    sassOptions: {
      outputStyle: 'expanded'
    }
  }

  // If we *did* resolve an implementation, pass it explicitly to sass-loader.
  // Otherwise, let sass-loader perform its own default resolution.
  if (implementation) {
    base.implementation = implementation
  }

  return base
}

export async function maybeUseSass(projectPath: string): Promise<void> {
  if (!isUsingSass(projectPath)) return

  await ensureOptionalContractPackageResolved({
    contractId: 'sass',
    projectPath,
    dependencyId: 'sass-loader'
  })
}

//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {createRequire} from 'module'
import colors from 'pintor'
import * as messages from '../css-lib/messages'
import {
  installOptionalDependencies,
  hasDependency,
  resolveDevelopInstallRoot
} from '../css-lib/integrations'

let userMessageDelivered = false

export function isUsingSass(projectPath: string): boolean {
  if (hasDependency(projectPath, 'sass')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          `${colors.brightMagenta('►►► Author says')} ${messages.isUsingIntegration('SASS')}`
        )
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

type Loader = Record<string, any>

function resolveSassLoader(projectPath: string): string | undefined {
  const extensionRoot = resolveDevelopInstallRoot()
  const paths = [projectPath, extensionRoot || undefined, process.cwd()].filter(
    Boolean
  ) as string[]

  try {
    return require.resolve('sass-loader', {paths})
  } catch {
    return undefined
  }
}

/**
 * Resolve the Sass implementation from the user's project first, then fall back
 * to the Extension.js cache/runtime. This mirrors the PostCSS/Tailwind
 * resolution strategy so we don't depend on Node resolving `sass` from the
 * loader path inside the npx cache.
 */
export function resolveSassImplementation(
  projectPath: string
): any | undefined {
  const bases = [projectPath, process.cwd()]

  for (const base of bases) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      let mod = req('sass')

      if (mod && typeof mod === 'object' && 'default' in mod) {
        mod = (mod as any).default
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
    let mod = require('sass')

    if (mod && typeof mod === 'object' && 'default' in mod) {
      mod = (mod as any).default
    }

    return mod
  } catch {
    return undefined
  }
}

export function createSassLoaderOptions(
  projectPath: string,
  mode: 'development' | 'production'
): Record<string, any> {
  const implementation = resolveSassImplementation(projectPath)
  const usingSass = isUsingSass(projectPath)

  // Project declares "sass" but we cannot resolve any implementation from
  // the project or extension runtime – surface a clear error.
  if (usingSass && !implementation) {
    throw new Error(messages.missingSassDependency())
  }

  const base: Record<string, any> = {
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

export async function maybeUseSass(projectPath: string): Promise<Loader[]> {
  if (!isUsingSass(projectPath)) return []

  let sassLoaderPath = resolveSassLoader(projectPath)

  if (!sassLoaderPath) {
    const postCssDependencies = [
      'postcss-loader',
      'postcss-scss',
      'postcss-preset-env'
    ]

    const didInstallPostCss = await installOptionalDependencies(
      'PostCSS',
      postCssDependencies
    )

    if (!didInstallPostCss) {
      throw new Error('[PostCSS] Optional dependencies failed to install.')
    }

    // We expect users to install "sass" in their project. Here we only
    // bootstrap the loader itself so that the npx / cache-based runtime
    // can function without users having to think about peer deps.
    const sassDependencies = ['sass-loader']

    const didInstallSass = await installOptionalDependencies(
      'SASS',
      sassDependencies
    )

    if (!didInstallSass) {
      throw new Error('[SASS] Optional dependencies failed to install.')
    }

    sassLoaderPath = resolveSassLoader(projectPath)
    if (!sassLoaderPath) {
      throw new Error(
        '[SASS] sass-loader could not be resolved after optional dependency installation.'
      )
    }

    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.youAreAllSet('SASS'))
    }
  }

  return [
    // Regular .sass/.scss files
    {
      test: /\.(sass|scss)$/,
      exclude: /\.module\.(sass|scss)$/,
      use: [
        {
          loader: sassLoaderPath,
          options: createSassLoaderOptions(projectPath, 'development')
        }
      ]
    },
    // Module .sass/.scss files
    {
      test: /\.module\.(sass|scss)$/,
      use: [
        {
          loader: sassLoaderPath,
          options: createSassLoaderOptions(projectPath, 'development')
        }
      ]
    }
  ]
}

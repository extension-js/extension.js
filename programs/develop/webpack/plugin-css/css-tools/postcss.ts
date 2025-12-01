// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

import * as path from 'path'
import * as fs from 'fs'
import {createRequire} from 'module'
import * as messages from '../css-lib/messages'
import {
  installOptionalDependencies,
  hasDependency
} from '../css-lib/integrations'
import {isUsingTailwind} from './tailwind'
import {isUsingSass} from './sass'
import {isUsingLess} from './less'
import type {StyleLoaderOptions} from '../common-style-loaders'

let userMessageDelivered = false

const postCssConfigFiles = [
  '.postcssrc',
  '.postcssrc.json',
  '.postcssrc.yaml',
  '.postcssrc.yml',
  'postcss.config.mjs',
  '.postcssrc.js',
  '.postcssrc.cjs',
  'postcss.config.js',
  'postcss.config.cjs'
]

function findPostCssConfig(projectPath: string): string | undefined {
  for (const configFile of postCssConfigFiles) {
    const configPath = path.join(projectPath, configFile)
    if (fs.existsSync(configPath)) {
      return configPath
    }
  }
  return undefined
}

export function isUsingPostCss(projectPath: string): boolean {
  if (hasDependency(projectPath, 'postcss')) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.isUsingIntegration('PostCSS'))
      }

      userMessageDelivered = true
    }
    return true
  }

  if (findPostCssConfig(projectPath)) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.isUsingIntegration('PostCSS'))
      }

      userMessageDelivered = true
    }

    return true
  }

  if (isUsingTailwind(projectPath)) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(messages.isUsingIntegration('PostCSS'))
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

export async function maybeUsePostCss(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<Record<string, any>> {
  const userPostCssConfig = findPostCssConfig(projectPath)

  function hasPostCssInPackageJson(p: string): boolean {
    try {
      const raw = fs.readFileSync(path.join(p, 'package.json'), 'utf8')
      const pkg = JSON.parse(raw || '{}')
      return !!pkg?.postcss
    } catch {
      return false
    }
  }

  const pkgHasPostCss = hasPostCssInPackageJson(projectPath)
  const tailwindPresent = isUsingTailwind(projectPath)

  // Only add postcss-loader when there's a clear signal of usage
  if (!userPostCssConfig && !pkgHasPostCss && !tailwindPresent) {
    return {}
  }

  // If Tailwind is present and we might need to inline it later, 
  // ake sure it can be resolved from the project
  if (tailwindPresent) {
    try {
      const req = createRequire(path.join(projectPath, 'package.json'))
      req.resolve('@tailwindcss/postcss')
    } catch {
      console.error(
        `PostCSS plugin "@tailwindcss/postcss" not found in ${projectPath}.\n` +
          `Install it in that package (e.g. "pnpm add -D @tailwindcss/postcss") and retry.`
      )
      process.exit(1)
    }
  }

  try {
    require.resolve('postcss-loader')
  } catch (e) {
    // SASS and LESS will install PostCSS as a dependency
    // so we don't need to check for it here.
    if (!isUsingSass(projectPath) && !isUsingLess(projectPath)) {
      const postCssDependencies = ['postcss', 'postcss-loader']

      await installOptionalDependencies('PostCSS', postCssDependencies)
    }

    console.log(messages.youAreAllSet('PostCSS'))
    process.exit(0)
  }

  // Resolve the project's own PostCSS implementation to avoid resolving from the toolchain
  function getProjectPostcssImpl(): any {
    try {
      const req = createRequire(path.join(projectPath, 'package.json'))
      return req('postcss')
    } catch {
      try {
        // Fallback to loader's postcss if not found in project
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('postcss')
      } catch {
        return undefined
      }
    }
  }

  // Use createRequire from project path for plugin resolution
  const reqFromProject = createRequire(path.join(projectPath, 'package.json'))

  // If there is no user config but Tailwind is present, inline the plugin to avoid
  // relying on string-based resolution that could point to the tool's node_modules.
  let inlinePlugins: any[] | undefined
  if (!userPostCssConfig && !pkgHasPostCss && tailwindPresent) {
    try {
      inlinePlugins = [reqFromProject('@tailwindcss/postcss')]
    } catch {
      console.error(
        `PostCSS plugin "@tailwindcss/postcss" not found in ${projectPath}.\n` +
          `Install it in that package (e.g. "pnpm add -D @tailwindcss/postcss") and retry.`
      )
      process.exit(1)
    }
  }

  return {
    test: /\.css$/,
    type: 'css',
    loader: require.resolve('postcss-loader'),
    options: {
      // Prefer the project's PostCSS implementation so plugins resolve from the project
      implementation: getProjectPostcssImpl(),
      postcssOptions: {
        ident: 'postcss',
        // Ensure resolution and discovery happen from the project root
        cwd: projectPath,
        // Only enable config discovery when the user has a config; otherwise disable
        // discovery and rely on inline plugins (e.g., Tailwind) to avoid cross-CWD resolution.
        config: userPostCssConfig || pkgHasPostCss ? projectPath : false,
        // Inline Tailwind when we detected it but there is no user config.
        plugins: inlinePlugins
      },
      sourceMap: opts.mode === 'development'
    }
  }
}

import path from 'path'
import fs from 'fs'
import {StyleLoaderOptions} from '../common-style-loaders'
import * as messages from '../../lib/messages'
import {isUsingTailwind, maybeUseTailwind} from './tailwind'
import {isUsingSass} from './sass'
import {isUsingLess} from './less'
import {installOptionalDependencies} from '../../lib/utils'

let userMessageDelivered = false

export function isUsingPostCss(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  const postCssConfigFiles = [
    '.postcssrc',
    '.postcssrc.json',
    '.postcssrc.yaml',
    '.postcssrc.yml',
    '.postcssrc.js',
    '.postcssrc.cjs',
    'postcss.config.js',
    'postcss.config.cjs'
  ]

  if (fs.existsSync(packageJsonPath)) {
    const packageJson = require(packageJsonPath)
    if (packageJson.postcss) {
      if (!userMessageDelivered) {
        const manifest = require(manifestJsonPath)
        console.log(messages.isUsingTechnology(manifest, 'PostCSS'))
        userMessageDelivered = true
      }
      return true
    }
  }

  for (const configFile of postCssConfigFiles) {
    if (fs.existsSync(path.join(projectPath, configFile))) {
      if (!userMessageDelivered) {
        const manifest = require(manifestJsonPath)
        console.log(messages.isUsingTechnology(manifest, 'PostCSS'))
        userMessageDelivered = true
      }
      return true
    }
  }

  if (isUsingTailwind(projectPath)) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      console.log(messages.isUsingTechnology(manifest, 'PostCSS'))
      userMessageDelivered = true
    }
    return true
  }

  return false
}

type Loader = Record<string, any>

export async function maybeUsePostCss(
  projectPath: string,
  opts: StyleLoaderOptions
): Promise<Loader> {
  if (!isUsingPostCss(projectPath)) return {}

  try {
    require.resolve('postcss-loader')
  } catch (e) {
    // SASS and LESS will install PostCSS as a dependency
    // so we don't need to check for it here.
    if (!isUsingSass(projectPath) && !isUsingLess(projectPath)) {
      const postCssDependencies = [
        'postcss',
        'postcss-loader',
        'postcss-scss',
        'postcss-flexbugs-fixes',
        'postcss-preset-env',
        'postcss-normalize'
      ]

      await installOptionalDependencies('PostCSS', postCssDependencies)

      // The compiler will exit after installing the dependencies
      // as it can't read the new dependencies without a restart.
      console.log(messages.youAreAllSet('PostCSS'))
      process.exit(0)
    }
  }

  const maybeInstallTailwind = await maybeUseTailwind(projectPath)

  return {
    loader: require.resolve('postcss-loader'),
    options: {
      postcssOptions: {
        parser: require.resolve('postcss-scss'),
        ident: 'postcss',
        config: false,
        plugins: [
          ...maybeInstallTailwind,
          require.resolve('postcss-flexbugs-fixes'),
          [
            require.resolve('postcss-preset-env'),
            {
              autoprefixer: {
                flexbox: 'no-2009'
              },
              stage: 3
            }
          ],
          require.resolve('postcss-normalize')
        ]
      },
      sourceMap: opts.mode === 'development'
    }
  }
}

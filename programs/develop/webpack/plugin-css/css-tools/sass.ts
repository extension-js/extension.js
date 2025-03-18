import path from 'path'
import fs from 'fs'
import * as messages from '../../lib/messages'
import {installOptionalDependencies} from '../../lib/utils'

let userMessageDelivered = false

export function isUsingSass(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const sassAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.sass
  const sassAsDep = packageJson.dependencies && packageJson.dependencies.sass

  if (sassAsDevDep || sassAsDep) {
    if (!userMessageDelivered) {
      if (process.env.EXTENSION_ENV === 'development') {
        console.log(messages.isUsingIntegration('SASS'))
      }

      userMessageDelivered = true
    }
    return true
  }

  return false
}

type Loader = Record<string, any>

export async function maybeUseSass(projectPath: string): Promise<Loader[]> {
  if (!isUsingSass(projectPath)) return []

  try {
    require.resolve('sass-loader')
  } catch (e) {
    const postCssDependencies = [
      'postcss-loader',
      'postcss-scss',
      'postcss-flexbugs-fixes',
      'postcss-preset-env',
      'postcss-normalize'
    ]

    await installOptionalDependencies('PostCSS', postCssDependencies)

    const sassDependencies = [
      'sass',
      'sass-loader',
      'sass-embedded',
      'resolve-url-loader'
    ]

    await installOptionalDependencies('SASS', sassDependencies)

    // The compiler will exit after installing the dependencies
    // as it can't read the new dependencies without a restart.
    console.log(messages.youAreAllSet('SASS'))
    process.exit(0)
  }

  return [
    {
      test: /\.(sass|scss)$/,
      use: [
        {
          loader: require.resolve('sass-loader'),
          options: {
            // using `modern-compiler` and `sass-embedded` together
            // significantly improve build performance,
            // requires `sass-loader >= 14.2.1`
            api: 'modern-compiler',
            implementation: require.resolve('sass-embedded')
          }
        }
      ],
      type: 'css/auto'
    }
  ]
}

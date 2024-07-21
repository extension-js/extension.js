import path from 'path'
import fs from 'fs'
import {bold, blue, cyan} from '@colors/colors/safe'
import {execSync} from 'child_process'
import {commonStyleLoaders} from '../common-style-loaders'
import {DevOptions} from '../../../types'

let userMessageDelivered = false

export function isUsingSass(projectDir: string): boolean {
  const packageJsonPath = path.join(projectDir, 'package.json')
  const manifestJsonPath = path.join(projectDir, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const sassAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.sass
  const sassAsDep = packageJson.dependencies && packageJson.dependencies.sass

  if (sassAsDevDep || sassAsDep) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      console.log(
        bold(
          `🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${
            manifest.version
          }) `
        ) + `is using ${bold(cyan('sass'))}.`
      )
      userMessageDelivered = true
    }
    return true
  }

  return false
}

function installSass(): void {
  console.log('Sass is not installed. Installing...')
  execSync('npm install sass', {stdio: 'inherit'})
  console.log('Sass and related loaders installed successfully.')
}

type Loader = Record<string, any>

export function maybeUseSass(
  projectDir: string,
  opts: {mode: DevOptions['mode']}
): Loader[] {
  if (isUsingSass(projectDir)) {
    try {
      require.resolve('sass')
    } catch (e) {
      installSass()
    }

    return [
      {
        test: /\.(scss|sass)$/,
        exclude: /\.module\.css$/,
        // https://stackoverflow.com/a/60482491/4902448
        oneOf: [
          {
            resourceQuery: /is_content_css_import=true/,
            use: commonStyleLoaders(projectDir, {
              regex: /\.(scss|sass)$/,
              loader: require.resolve('sass-loader'),
              mode: opts.mode,
              useMiniCssExtractPlugin: false
            })
          },
          {
            use: commonStyleLoaders(projectDir, {
              regex: /\.(scss|sass)$/,
              loader: require.resolve('sass-loader'),
              mode: opts.mode,
              useMiniCssExtractPlugin: true
            })
          }
        ]
      },
      {
        test: /\.module\.(scss|sass)$/,
        // https://stackoverflow.com/a/60482491/4902448
        oneOf: [
          {
            resourceQuery: /is_content_css_import=true/,
            use: commonStyleLoaders(projectDir, {
              regex: /\.(scss|sass)$/,
              loader: require.resolve('sass-loader'),
              mode: opts.mode,
              useMiniCssExtractPlugin: false
            })
          },
          {
            use: commonStyleLoaders(projectDir, {
              regex: /\.(scss|sass)$/,
              loader: require.resolve('sass-loader'),
              mode: opts.mode,
              useMiniCssExtractPlugin: true
            })
          }
        ],
        use: commonStyleLoaders(projectDir, {
          regex: /\.module\.(scss|sass)$/,
          loader: require.resolve('sass-loader'),
          mode: opts.mode,
          useMiniCssExtractPlugin: true
        })
      }
    ]
  }
  return []
}

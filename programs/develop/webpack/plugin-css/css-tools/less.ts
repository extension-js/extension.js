import path from 'path'
import fs from 'fs'
import {bold, blue, cyan} from '@colors/colors/safe'
import {execSync} from 'child_process'
import {commonStyleLoaders} from '../common-style-loaders'
import {DevOptions} from '../../../types'

let userMessageDelivered = false

export function isUsingLess(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')
  const manifestJsonPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const lessAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.less
  const lessAsDep = packageJson.dependencies && packageJson.dependencies.less

  if (lessAsDevDep || lessAsDep) {
    if (!userMessageDelivered) {
      const manifest = require(manifestJsonPath)
      console.log(
        bold(
          `🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${
            manifest.version
          }) `
        ) + `is using ${bold(cyan('less'))}.`
      )
      userMessageDelivered = true
    }
    return true
  }

  return false
}

function installLess(): void {
  console.log('Less is not installed. Installing...')
  execSync('npm install less', {stdio: 'inherit'})
  console.log('Less and related loaders installed successfully.')
}

type Loader = Record<string, any>

export function maybeUseLess(
  projectPath: string,
  mode: DevOptions['mode']
): Loader[] {
  if (isUsingLess(projectPath)) {
    try {
      require.resolve('less')
    } catch (e) {
      installLess()
    }

    return [
      {
        test: /\.less$/,
        exclude: /\.module\.css$/,
        // https://stackoverflow.com/a/60482491/4902448
        oneOf: [
          {
            resourceQuery: /is_content_css_import=true/,
            use: commonStyleLoaders(projectPath, {
              regex: /\.less$/,
              loader: require.resolve('less-loader'),
              mode,
              useMiniCssExtractPlugin: false
            })
          },
          {
            use: commonStyleLoaders(projectPath, {
              regex: /\.less$/,
              loader: require.resolve('less-loader'),
              mode,
              useMiniCssExtractPlugin: true
            })
          }
        ]
      }
    ]
  }

  return []
}

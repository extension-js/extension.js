//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import fs from 'fs/promises'
import * as utils from '../lib/utils'
import * as messages from '../lib/messages'

const extensionJsPackageJsonScripts = {
  dev:
    process.env.EXTENSION_ENV === 'development'
      ? 'node node_modules/extension dev'
      : 'extension dev',
  start:
    process.env.EXTENSION_ENV === 'development'
      ? 'node node_modules/extension start'
      : 'extension start',
  build:
    process.env.EXTENSION_ENV === 'development'
      ? 'node node_modules/extension build'
      : 'extension build'
}

export async function overridePackageJson(
  projectPath: string,
  projectName: string,
  template: string
) {
  const templatePath = utils.getTemplatePath(process.cwd())

  const packageJsonPath = utils.isExternalTemplate(template)
    ? path.join(projectPath, 'package.json')
    : path.join(templatePath, 'package.json')

  const packageJsonContent = await fs.readFile(packageJsonPath)
  const packageJson = JSON.parse(packageJsonContent.toString())

  packageJson.scripts = packageJson.scripts || {}
  packageJson.dependencies = packageJson.dependencies || {}
  packageJson.devDependencies = {
    ...(packageJson.devDependencies || {}),
    // During development, we want to use the local version of Extension.js
    extension: process.env.EXTENSION_ENV === 'development' ? '*' : 'latest'
  }

  const packageMetadata = {
    ...packageJson,
    name: path.basename(projectPath),
    private: true,
    scripts: {
      ...packageJson.scripts,
      ...extensionJsPackageJsonScripts
    },
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
    author: {
      name: 'Your Name',
      email: 'your@email.com',
      url: 'https://yourwebsite.com'
    }
  }

  try {
    console.log(messages.writingPackageJsonMetadata())
    await fs.writeFile(
      path.join(projectPath, 'package.json'),
      JSON.stringify(packageMetadata, null, 2)
    )
  } catch (error: any) {
    console.error(messages.writingPackageJsonMetadataError(projectName, error))

    process.exit(1)
  }
}

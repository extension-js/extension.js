//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import * as messages from './messages'
import createDirectory from './steps/createDirectory'
import importExternalTemplate from './steps/importExternalTemplate'
import importLocalTemplate from './steps/importLocalTemplate'
import writePackageJson from './steps/writePackageJson'
import installDependencies from './steps/installDependencies'
import abortAndClean from './steps/abortProjectAndClean'
import isExternalTemplate from './helpers/isExternalTemplate'
import writeReadmeFile from './steps/writeReadmeFile'
import generateExtensionTypes from './steps/generateExtensionTypes'
import isTypeScriptTemplate from './helpers/isTypeScriptTemplate'

export interface CreateOptions {
  template?: string
  targetDir?: string
}

export default async function createExtension(
  projectName: string | undefined,
  {targetDir = process.cwd(), template = 'web'}: CreateOptions
) {
  if (!projectName) {
    messages.noProjectName()
    process.exit(1)
  }

  if (projectName.startsWith('http')) {
    messages.noUrlAllowed()
    process.exit(1)
  }

  try {
    await createDirectory(targetDir, projectName)

    if (isExternalTemplate(template)) {
      await importExternalTemplate(targetDir, projectName, template)
    } else {
      await importLocalTemplate(targetDir, projectName, template)
    }

    await writePackageJson(targetDir, projectName, template)
    await installDependencies(targetDir, projectName)
    await writeReadmeFile(targetDir, projectName, template)

    if (isTypeScriptTemplate(template)) {
      await generateExtensionTypes(targetDir, projectName)
    }

    // All good!
    messages.successfullInstall(targetDir, projectName)
  } catch (error: any) {
    await abortAndClean(error, targetDir, projectName)
  }
}

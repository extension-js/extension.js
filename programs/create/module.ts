//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'
import * as messages from './messages'
import createDirectory from './steps/createDirectory'
// import importExternalTemplate from './steps/importExternalTemplate'
import importLocalTemplate from './steps/importLocalTemplate'
import writePackageJson from './steps/writePackageJson'
import installDependencies from './steps/installDependencies'
import abortAndClean from './steps/abortProjectAndClean'
// import isExternalTemplate from './helpers/isExternalTemplate'
import writeReadmeFile from './steps/writeReadmeFile'
import writeManifestJson from './steps/writeManifestJson'
import generateExtensionTypes from './steps/generateExtensionTypes'
import isTypeScriptTemplate from './helpers/isTypeScriptTemplate'
import initializeGitRepository from './steps/initializeGitRepository'

export interface CreateOptions {
  template?: string
  // TODO cezaraugusto deprecated
  targetDir?: string
}

export default async function createExtension(
  projectNameInput: string | undefined,
  {template = 'init'}: CreateOptions
) {
  if (!projectNameInput) {
    messages.noProjectName()
    process.exit(1)
  }

  if (projectNameInput.startsWith('http')) {
    messages.noUrlAllowed()
    process.exit(1)
  }

  // check if path is aboslute
  const projectPath = path.isAbsolute(projectNameInput)
    ? projectNameInput
    : path.join(process.cwd(), projectNameInput)

  const projectName = path.basename(projectPath)

  try {
    await createDirectory(projectPath, projectName)

    // if (isExternalTemplate(template)) {
    //   await importExternalTemplate(targetDir, projectName, template)
    // } else {
    await importLocalTemplate(projectPath, projectName, template)
    // }

    await writePackageJson(projectPath, projectName, template)
    await installDependencies(projectPath, projectName)
    await writeReadmeFile(projectPath, projectName, template)
    await writeManifestJson(projectPath, projectName)
    await initializeGitRepository(projectPath, projectName)

    if (isTypeScriptTemplate(template)) {
      await generateExtensionTypes(projectPath, projectName)
    }

    // All good!
    messages.successfullInstall(projectPath, projectName)
  } catch (error: any) {
    await abortAndClean(error, projectPath, projectName)
  }
}

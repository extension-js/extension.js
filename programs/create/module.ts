import path from 'path'
import * as messages from './lib/messages'
import * as utils from './lib/utils'
import {createDirectory} from './steps/create-directory'
import {importLocalTemplate} from './steps/import-local-template'
import {importExternalTemplate} from './steps/import-external-template'
import {overridePackageJson} from './steps/write-package-json'
import {installDependencies} from './steps/install-dependencies'
import {writeReadmeFile} from './steps/write-readme-file'
import {writeManifestJson} from './steps/write-manifest-json'
import {generateExtensionTypes} from './steps/generate-extension-types'
import {writeGitignore} from './steps/write-gitignore'
import {initializeGitRepository} from './steps/initialize-git-repository'

export interface CreateOptions {
  template: string
  install?: boolean
}

export async function extensionCreate(
  projectNameInput: string | undefined,
  {template = 'init', install = true}: CreateOptions
) {
  if (!projectNameInput) {
    throw new Error(messages.noProjectName())
  }

  if (projectNameInput.startsWith('http')) {
    throw new Error(messages.noUrlAllowed())
  }

  // Check if path is absolute
  const projectPath = path.isAbsolute(projectNameInput)
    ? projectNameInput
    : path.join(process.cwd(), projectNameInput)

  const projectName = path.basename(projectPath)

  try {
    await createDirectory(projectPath, projectName)

    if (template === 'init') {
      await importLocalTemplate(projectPath, projectName, template)
    } else {
      await importExternalTemplate(projectPath, projectName, template)
    }

    await overridePackageJson(projectPath, projectName, template)

    if (install) {
      await installDependencies(projectPath, projectName)
    }

    await writeReadmeFile(projectPath, projectName)
    await writeManifestJson(projectPath, projectName)
    await initializeGitRepository(projectPath, projectName)
    await writeGitignore(projectPath)

    if (utils.isTypeScriptTemplate(template)) {
      await generateExtensionTypes(projectPath, projectName)
    }

    // All good!
    const successfulInstall = await messages.successfullInstall(
      projectPath,
      projectName
    )

    console.log(successfulInstall)
  } catch (error) {
    console.error(error)
    // Re-throw the error so it can be caught in tests
    throw error
  }
}

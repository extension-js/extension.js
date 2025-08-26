import * as path from 'path'
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
import {setupBuiltInTests} from './steps/setup-built-in-tests'

export interface CreateOptions {
  template: string
  install?: boolean
  cliVersion?: string
}

export async function extensionCreate(
  projectNameInput: string | undefined,
  {cliVersion, template = 'init', install = false}: CreateOptions
) {
  if (!projectNameInput) {
    throw new Error(messages.noProjectName())
  }

  // Maintain existing behavior: URLs are not allowed as project paths for create
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
    // If the template parameter looks like a remote path, import from remote
    // Otherwise, use the local built-in template workflow
    await importExternalTemplate(projectPath, projectName, template)
    await overridePackageJson(projectPath, projectName, {
      template,
      cliVersion
    })

    if (install) {
      await installDependencies(projectPath, projectName)
    }

    await writeReadmeFile(projectPath, projectName)
    await writeManifestJson(projectPath, projectName)
    await initializeGitRepository(projectPath, projectName)
    await writeGitignore(projectPath)
    await setupBuiltInTests(projectPath, projectName)

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

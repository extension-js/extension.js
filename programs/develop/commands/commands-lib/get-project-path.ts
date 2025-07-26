import * as path from 'path'
import * as fs from 'fs'
import goGitIt from 'go-git-it'
import * as messages from './messages'
import {downloadAndExtractZip} from './extract-from-zip'
import {
  findNearestPackageJson,
  validatePackageJson
} from './find-nearest-package'

/**
 * Represents the project structure with separate manifest and package.json locations
 */
export interface ProjectStructure {
  manifestPath: string
  packageJsonPath: string
}

const isUrl = (url: string) => {
  try {
    // eslint-disable-next-line no-new
    new URL(url)
    return true
  } catch (e) {
    return false
  }
}

async function importUrlSourceFromGithub(
  pathOrRemoteUrl: string,
  text: string
) {
  await goGitIt(pathOrRemoteUrl, process.cwd(), text)

  return path.resolve(process.cwd(), path.basename(pathOrRemoteUrl))
}

async function importUrlSourceFromZip(pathOrRemoteUrl: string) {
  const zipFilePath = await downloadAndExtractZip(
    pathOrRemoteUrl,
    process.cwd()
  )

  return zipFilePath
  // return path.resolve(process.cwd(), path.basename(pathOrRemoteUrl))
}

export async function getProjectPath(
  pathOrRemoteUrl: string | undefined
): Promise<string> {
  if (!pathOrRemoteUrl) {
    return process.cwd()
  }

  if (isUrl(pathOrRemoteUrl)) {
    const url = new URL(pathOrRemoteUrl)

    if (url.protocol.startsWith('http')) {
      if (url.origin !== 'https://github.com') {
        const urlSource = await importUrlSourceFromZip(pathOrRemoteUrl)

        return urlSource
      }

      const urlData = url.pathname.split('/')
      const owner = urlData.slice(1, 3)[0]
      const project = urlData.slice(1, 3)[1]

      console.log(messages.fetchingProjectPath(owner, project))

      const projectName = path.basename(url.pathname)

      const urlSource = await importUrlSourceFromGithub(
        pathOrRemoteUrl,
        messages.downloadingProjectPath(projectName)
      )

      console.log(messages.creatingProjectPath(projectName))

      return urlSource
    }
  }

  return path.resolve(process.cwd(), pathOrRemoteUrl)
}

/**
 * Gets the project structure with manifest and package.json locations
 * Supports monorepo structure where manifest and package.json may be in different directories
 */
export async function getProjectStructure(
  pathOrRemoteUrl: string | undefined
): Promise<ProjectStructure> {
  const projectPath = await getProjectPath(pathOrRemoteUrl)

  // Search for manifest.json recursively in the project path
  let manifestPath = path.join(projectPath, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    // Try to find manifest.json in subdirectories
    const findManifest = (dir: string): string | null => {
      const files = fs.readdirSync(dir, {withFileTypes: true})

      for (const file of files) {
        if (file.isFile() && file.name === 'manifest.json') {
          return path.join(dir, file.name)
        }
        if (
          file.isDirectory() &&
          !file.name.startsWith('.') &&
          file.name !== 'node_modules' &&
          file.name !== 'dist'
        ) {
          const found = findManifest(path.join(dir, file.name))
          if (found) return found
        }
      }
      return null
    }

    const foundManifest = findManifest(projectPath)
    if (foundManifest) {
      manifestPath = foundManifest
    } else {
      throw new Error(messages.manifestNotFoundError(manifestPath))
    }
  }

  // Find nearest package.json
  const packageJsonPath = await findNearestPackageJson(manifestPath)

  if (!packageJsonPath || !validatePackageJson(packageJsonPath)) {
    throw new Error(messages.packageJsonNotFoundError(manifestPath))
  }

  return {
    manifestPath,
    packageJsonPath
  }
}

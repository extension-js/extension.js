import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import goGitIt from 'go-git-it'
import * as messages from './messages'
import {downloadAndExtractZip} from './extract-from-zip'
import {
  findNearestPackageJson,
  validatePackageJson
} from './find-nearest-package'

export interface ProjectStructure {
  manifestPath: string
  // Optional in web-only mode (no package manager present)
  packageJsonPath?: string
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
  // Create a temporary working directory for the download
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-js-'))

  await goGitIt(pathOrRemoteUrl, tempRoot, text)

  // With go-git-it v5.0.0, files are downloaded to a subfolder matching the repo name
  // Robustly resolve the repository name as the second pathname segment: /:owner/:repo/...
  const url = new URL(pathOrRemoteUrl)
  const segments = url.pathname.split('/').filter(Boolean)
  const repoName =
    segments.length >= 2 ? segments[1] : segments[segments.length - 1]

  const candidates = fs
    .readdirSync(tempRoot, {withFileTypes: true})
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  // Prefer the expected repo folder, otherwise fall back to the first directory
  const chosen = candidates.includes(repoName) ? repoName : candidates[0]
  const resolved = chosen ? path.resolve(tempRoot, chosen) : tempRoot
  return resolved
}

async function importUrlSourceFromZip(pathOrRemoteUrl: string) {
  // Create a temporary working directory for the download and extraction
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-js-'))
  const extractedPath = await downloadAndExtractZip(pathOrRemoteUrl, tempRoot)

  return extractedPath
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

      console.log(messages.creatingProjectPath(url.pathname))

      return urlSource
    }
  }

  return path.resolve(process.cwd(), pathOrRemoteUrl)
}

// Gets the project structure with manifest and package.json locations
// Supports monorepo structure where manifest and package.json may be in different directories
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

  // Find nearest package.json, but allow web-only mode when absent or invalid
  const packageJsonPath = await findNearestPackageJson(manifestPath)

  if (!packageJsonPath || !validatePackageJson(packageJsonPath)) {
    // Web-only mode: proceed without a package.json
    return {
      manifestPath
    }
  }

  return {
    manifestPath,
    packageJsonPath
  }
}

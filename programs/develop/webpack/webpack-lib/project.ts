// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import * as messages from './messages'
import {findNearestPackageJson, validatePackageJson} from './package-json'

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
  // Clone into the current working directory. go-git-it creates a subfolder
  // typically matching the repo name (or last segment for tree URLs).
  const cwd = process.cwd()
  const url = new URL(pathOrRemoteUrl)
  const segments = url.pathname.split('/').filter(Boolean)
  const repoName =
    segments.length >= 2 ? segments[1] : segments[segments.length - 1]
  const treeIndex = segments.indexOf('tree')

  // If a previous run left an empty directory with the expected name, remove it
  // to avoid go-git-it failing on rename with ENOTEMPTY.
  const expectedName =
    treeIndex !== -1 && segments.length > treeIndex + 2
      ? segments[segments.length - 1]
      : repoName

  const expectedPath = path.resolve(cwd, expectedName)

  if (fs.existsSync(expectedPath)) {
    try {
      const entries = fs.readdirSync(expectedPath)
      if (entries.length === 0) {
        fs.rmSync(expectedPath, {recursive: true, force: true})
      } else {
        // If directory exists but does not contain a manifest.json anywhere,
        // remove it and re-fetch to avoid stale/partial folders.
        const hasManifest = (dir: string): boolean => {
          const stack: string[] = [dir]
          while (stack.length) {
            const current = stack.pop() as string
            const items = fs.readdirSync(current, {withFileTypes: true})
            for (const it of items) {
              if (it.isFile() && it.name === 'manifest.json') return true
              if (
                it.isDirectory() &&
                it.name !== 'node_modules' &&
                it.name !== 'dist' &&
                !it.name.startsWith('.')
              ) {
                stack.push(path.join(current, it.name))
              }
            }
          }
          return false
        }

        if (!hasManifest(expectedPath)) {
          fs.rmSync(expectedPath, {recursive: true, force: true})
        } else {
          // Directory exists and is a valid extension root; use it as-is
          return expectedPath
        }
      }
    } catch {
      // If we cannot read dir, proceed and let go-git-it attempt clone
    }
  }

  async function tryGitClone() {
    const {default: goGitIt} = await import('go-git-it')
    await goGitIt(pathOrRemoteUrl, cwd, text)
  }

  async function tryZipFallback() {
    // Build a GitHub ZIP URL and extract the repository, then resolve subdir
    const branch =
      treeIndex !== -1 && segments.length > treeIndex + 1
        ? segments[treeIndex + 1]
        : 'main'
    const owner = segments[0]
    const repo = segments[1]
    const subdir =
      treeIndex !== -1 && segments.length > treeIndex + 2
        ? segments.slice(treeIndex + 2).join('/')
        : ''

    const zipUrl = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`
    const extractedPath = await importUrlSourceFromZip(zipUrl)

    // Locate the extracted repo root (usually <repo>-<branch>)
    const extractedDirs = fs
      .readdirSync(extractedPath, {withFileTypes: true})
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    const repoRootDir = extractedDirs.find((d) =>
      d.startsWith(`${repo}-${branch}`)
    )
    const repoRoot = repoRootDir
      ? path.join(extractedPath, repoRootDir)
      : extractedPath

    return subdir ? path.join(repoRoot, subdir) : repoRoot
  }

  try {
    await tryGitClone()
  } catch {
    return await tryZipFallback()
  }

  // Prefer candidates based on URL
  const candidates: string[] = []

  if (treeIndex !== -1 && segments.length > treeIndex + 2) {
    candidates.push(segments[segments.length - 1])
  }

  candidates.push(repoName)

  for (const name of candidates) {
    const p = path.resolve(cwd, name)

    if (fs.existsSync(p)) {
      return p
    }
  }

  // As a last resort, attempt to find a newly created directory that has a manifest.json
  const dirs = fs
    .readdirSync(cwd, {withFileTypes: true})
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  for (const dir of dirs) {
    const manifestPath = path.join(cwd, dir, 'manifest.json')
    if (fs.existsSync(manifestPath)) return path.join(cwd, dir)
  }

  // As a last attempt for GitHub ZIP fallback, scan for a newly extracted repo root
  try {
    const dirs = fs
      .readdirSync(cwd, {withFileTypes: true})
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    const ghRoot = dirs.find((d) => /-main$|-master$/.test(d))

    if (ghRoot) {
      return path.join(cwd, ghRoot)
    }
  } catch {}

  throw new Error(messages.downloadedProjectFolderNotFound(cwd, candidates))
}

async function importUrlSourceFromZip(pathOrRemoteUrl: string) {
  // Extract directly into the current working directory so users can edit it
  const cwd = process.cwd()
  const {downloadAndExtractZip} = await import('./zip')
  const extractedPath = await downloadAndExtractZip(pathOrRemoteUrl, cwd)
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
      const pathname = url.pathname.toLowerCase()

      // GitHub release artifacts and other direct ZIP URLs should bypass
      // repository cloning logic and be downloaded/extracted directly.
      if (pathname.endsWith('.zip')) {
        return await importUrlSourceFromZip(pathOrRemoteUrl)
      }

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

  const isUnderDir = (baseDir: string, candidatePath: string): boolean => {
    const rel = path.relative(baseDir, candidatePath)
    return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel))
  }

  // Find nearest package.json from the project root (if any).
  const packageJsonPathFromProject = await findNearestPackageJson(
    path.join(projectPath, 'manifest.json')
  )
  const packageJsonDirFromProject = packageJsonPathFromProject
    ? path.dirname(packageJsonPathFromProject)
    : undefined

  // Prefer conventional locations before recursive search:
  // - <root>/manifest.json
  // - <root>/src/manifest.json
  const rootManifestPath = path.join(projectPath, 'manifest.json')
  const srcManifestPath = path.join(projectPath, 'src', 'manifest.json')
  let manifestPath = fs.existsSync(srcManifestPath)
    ? srcManifestPath
    : rootManifestPath

  if (!fs.existsSync(manifestPath)) {
    // If we have a package.json at/above the project root, do NOT
    // guess a manifest from arbitrary subfolders. Force explicit location.
    if (packageJsonDirFromProject) {
      throw new Error(messages.manifestNotFoundError(manifestPath))
    }

    // Web-only mode: Try to find manifest.json in subdirectories
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
          file.name !== 'dist' &&
          file.name !== 'public'
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
  const packageJsonDir = packageJsonPath
    ? path.dirname(packageJsonPath)
    : undefined

  // Guard: never allow manifest.json to be resolved from <packageRoot>/public
  if (packageJsonDir) {
    const publicRoot = path.join(packageJsonDir, 'public')
    if (isUnderDir(publicRoot, manifestPath)) {
      const fallbackSrc = path.join(packageJsonDir, 'src', 'manifest.json')
      const fallbackRoot = path.join(packageJsonDir, 'manifest.json')
      if (fs.existsSync(fallbackSrc)) {
        manifestPath = fallbackSrc
      } else if (fs.existsSync(fallbackRoot)) {
        manifestPath = fallbackRoot
      } else {
        // If only public/ contains a manifest, treat as not found
        throw new Error(messages.manifestNotFoundError(fallbackRoot))
      }
    }
  }

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

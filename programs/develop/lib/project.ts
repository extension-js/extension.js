// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as messages from './messages'
import {findNearestPackageJson, validatePackageJson} from './package-json'
import {type ParsedJson, parseJsonSafe} from './parse-json-safe'
import {findNearestDenoConfigSync, validateDenoConfig} from './project-manifest'

export interface ProjectStructure {
  manifestPath: string
  // Optional in web-only mode (no package manager present)
  packageJsonPath?: string
  // deno.json(c) when the project is (also) a Deno project: still a full
  // project, with npm: imports installed via deno install.
  denoJsonPath?: string
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

const REMOTE_FETCH_TIMEOUT_MS = (() => {
  const raw = parseInt(String(process.env.EXTENSION_FETCH_TIMEOUT_MS || ''), 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000
})()

function withTimeout<T>(
  task: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(messages.remoteFetchTimedOut(label, ms))),
      ms
    )
  })

  return Promise.race([task, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
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
          return expectedPath
        }
      }
    } catch {
      // If we cannot read dir, proceed and let go-git-it attempt clone
    }
  }

  async function tryGitClone() {
    const {default: goGitIt} = await import('go-git-it')
    await withTimeout(
      goGitIt(pathOrRemoteUrl, cwd, text),
      REMOTE_FETCH_TIMEOUT_MS,
      pathOrRemoteUrl
    )
  }

  async function tryZipFallback() {
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

  const dirs = fs
    .readdirSync(cwd, {withFileTypes: true})
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  for (const dir of dirs) {
    const manifestPath = path.join(cwd, dir, 'manifest.json')
    if (fs.existsSync(manifestPath)) return path.join(cwd, dir)
  }

  try {
    const dirs = fs
      .readdirSync(cwd, {withFileTypes: true})
      .filter((d) => d.isDirectory())
      .map((d) => d.name)

    const ghRoot = dirs.find((d) => /-main$|-master$/.test(d))

    if (ghRoot) {
      return path.join(cwd, ghRoot)
    }
  } catch {
    // Ignore
  }

  throw new Error(messages.downloadedProjectFolderNotFound(cwd, candidates))
}

async function importUrlSourceFromZip(pathOrRemoteUrl: string) {
  // Extract directly into the current working directory so users can edit it
  const cwd = process.cwd()
  const {downloadAndExtractZip} = await import('./zip')
  const extractedPath = await withTimeout(
    downloadAndExtractZip(pathOrRemoteUrl, cwd),
    REMOTE_FETCH_TIMEOUT_MS,
    pathOrRemoteUrl
  )
  return extractedPath
}

async function importLocalSourceFromZip(zipFilePath: string) {
  const cwd = process.cwd()
  const {extractLocalZip} = await import('./zip')

  return await extractLocalZip(zipFilePath, cwd)
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

  const resolvedPath = path.resolve(process.cwd(), pathOrRemoteUrl)

  // A local `.zip` file is auto-extracted so `preview ./extension.zip` works
  // without a manual unzip step. Folders fall through unchanged.
  if (
    path.extname(resolvedPath).toLowerCase() === '.zip' &&
    fs.existsSync(resolvedPath) &&
    fs.statSync(resolvedPath).isFile()
  ) {
    return await importLocalSourceFromZip(resolvedPath)
  }

  return resolvedPath
}

function collectManifestCandidates(
  rootDir: string,
  maxDepth: number
): string[] {
  const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    'out',
    '.git',
    '.turbo',
    '.next',
    'coverage',
    '.cache',
    '.vercel'
  ])
  const results: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || results.length >= 10) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true})
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'manifest.json') {
        results.push(path.join(dir, entry.name))
        continue
      }
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !SKIP_DIRS.has(entry.name)
      ) {
        walk(path.join(dir, entry.name), depth + 1)
      }
    }
  }
  walk(rootDir, 0)
  return results
}

export async function getProjectStructure(
  pathOrRemoteUrl: string | undefined
): Promise<ProjectStructure> {
  const projectPath = await getProjectPath(pathOrRemoteUrl)

  const isUnderDir = (baseDir: string, candidatePath: string): boolean => {
    const rel = path.relative(baseDir, candidatePath)
    return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel))
  }

  const packageJsonPathFromProject = await findNearestPackageJson(
    path.join(projectPath, 'manifest.json')
  )
  const denoJsonPathFromProject = findNearestDenoConfigSync(
    path.join(projectPath, 'manifest.json')
  )
  const packageJsonDirFromProject = packageJsonPathFromProject
    ? path.dirname(packageJsonPathFromProject)
    : denoJsonPathFromProject
      ? path.dirname(denoJsonPathFromProject)
      : undefined

  const rootManifestPath = path.join(projectPath, 'manifest.json')
  const srcManifestPath = path.join(projectPath, 'src', 'manifest.json')
  let manifestPath = fs.existsSync(srcManifestPath)
    ? srcManifestPath
    : rootManifestPath

  if (!fs.existsSync(manifestPath)) {
    if (packageJsonDirFromProject) {
      const absoluteCandidates = collectManifestCandidates(projectPath, 3)
      const relativeCandidates = absoluteCandidates.map(
        (candidate) => path.relative(projectPath, candidate) || candidate
      )

      if (absoluteCandidates.length === 1) {
        manifestPath = absoluteCandidates[0]
        console.log(
          messages.resolvedWorkspaceManifest(projectPath, manifestPath)
        )
      } else {
        throw new Error(
          messages.manifestNotFoundError(manifestPath, relativeCandidates)
        )
      }
    } else {
      const MAX_DEPTH = 5

      const findManifest = (dir: string, depth: number): string | null => {
        if (depth > MAX_DEPTH) return null

        let files: fs.Dirent[]
        try {
          files = fs.readdirSync(dir, {withFileTypes: true})
        } catch {
          return null
        }

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
            const found = findManifest(path.join(dir, file.name), depth + 1)
            if (found) return found
          }
        }
        return null
      }

      const foundManifest = findManifest(projectPath, 0)
      if (foundManifest) {
        manifestPath = foundManifest
      } else {
        throw new Error(messages.manifestNotFoundError(manifestPath))
      }
    }
  }

  // PWA web-app manifests share the manifest.json filename; detect by signature
  // fields and re-resolve to a real extension manifest or fail clearly.
  const readManifestObject = (
    candidatePath: string
  ): ParsedJson | undefined => {
    try {
      const parsed = parseJsonSafe(fs.readFileSync(candidatePath))
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      )
        return undefined
      return parsed
    } catch {
      return undefined
    }
  }
  const isPwaManifest = (candidatePath: string): boolean => {
    const parsed = readManifestObject(candidatePath)
    if (!parsed || parsed.manifest_version != null) return false
    return (
      Array.isArray(parsed.icons) ||
      typeof parsed.start_url === 'string' ||
      typeof parsed.display === 'string' ||
      parsed.related_applications != null ||
      parsed.prefer_related_applications != null
    )
  }

  if (fs.existsSync(manifestPath) && isPwaManifest(manifestPath)) {
    const alternatives = collectManifestCandidates(projectPath, 3).filter(
      (candidate) =>
        path.resolve(candidate) !== path.resolve(manifestPath) &&
        readManifestObject(candidate)?.manifest_version != null
    )
    if (alternatives.length === 1) {
      manifestPath = alternatives[0]
      console.log(messages.resolvedWorkspaceManifest(projectPath, manifestPath))
    } else {
      throw new Error(messages.notAnExtensionManifestError(manifestPath))
    }
  }

  // Find nearest package.json and deno.json(c); web-only mode only applies
  // when neither is present or valid.
  const packageJsonPath = await findNearestPackageJson(manifestPath)
  const packageJsonDir = packageJsonPath
    ? path.dirname(packageJsonPath)
    : undefined

  const nearestDenoJsonPath = findNearestDenoConfigSync(manifestPath)
  const denoJsonPath =
    nearestDenoJsonPath && validateDenoConfig(nearestDenoJsonPath)
      ? nearestDenoJsonPath
      : undefined

  // Guard: never allow manifest.json to be resolved from <packageRoot>/public
  const projectRootDir =
    packageJsonDir ?? (denoJsonPath ? path.dirname(denoJsonPath) : undefined)
  if (projectRootDir) {
    const publicRoot = path.join(projectRootDir, 'public')
    if (isUnderDir(publicRoot, manifestPath)) {
      const fallbackSrc = path.join(projectRootDir, 'src', 'manifest.json')
      const fallbackRoot = path.join(projectRootDir, 'manifest.json')
      if (fs.existsSync(fallbackSrc)) {
        manifestPath = fallbackSrc
      } else if (fs.existsSync(fallbackRoot)) {
        manifestPath = fallbackRoot
      } else {
        throw new Error(messages.manifestNotFoundError(fallbackRoot))
      }
    }
  }

  if (!packageJsonPath || !validatePackageJson(packageJsonPath)) {
    // No (valid) package.json: a Deno-manifest project is still a full project;
    // only with no manifest at all do we fall back to web-only mode.
    return {
      manifestPath,
      ...(denoJsonPath ? {denoJsonPath} : {})
    }
  }

  return {
    manifestPath,
    packageJsonPath,
    ...(denoJsonPath ? {denoJsonPath} : {})
  }
}

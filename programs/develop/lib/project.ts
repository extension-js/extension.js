// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {codedError} from './coded-error'
import * as messages from './messages'
import {CODES, isDebug} from './messaging'
import {findNearestPackageJsonSync, validatePackageJson} from './package-json'
import {type ParsedJson, parseJsonSafe} from './parse-json-safe'
import {findNearestDenoConfigSync, validateDenoConfig} from './project-manifest'

// Any of these in a project manifest means that project is an Extension.js
// project, so it owns a manifest one directory below it.
const EXTENSION_DEPENDENCY_NAMES = [
  'extension',
  'extension-develop',
  'extension-create'
]

const EXTENSION_CONFIG_FILENAMES = [
  'extension.config.js',
  'extension.config.mjs',
  'extension.config.cjs'
]

function declaresExtension(projectManifestPath: string): boolean {
  let parsed: ParsedJson

  // An unreadable or malformed project manifest answers "no signal" rather
  // than failing the run: this only decides which root to adopt.
  try {
    parsed = parseJsonSafe(
      fs.readFileSync(projectManifestPath, 'utf-8')
    ) as ParsedJson
  } catch {
    return false
  }

  if (!parsed || typeof parsed !== 'object') return false

  const record = parsed as Record<string, unknown>
  const named: string[] = []

  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies'
  ]) {
    const deps = record[field]
    if (deps && typeof deps === 'object') named.push(...Object.keys(deps))
  }

  // A Deno project names its dependencies as npm: specifiers in `imports`
  // rather than as a dependencies map, so read both sides of that map.
  const imports = record.imports

  if (imports && typeof imports === 'object') {
    for (const [key, value] of Object.entries(imports)) {
      named.push(key)
      if (typeof value === 'string') named.push(value)
    }
  }

  return named.some((entry) =>
    EXTENSION_DEPENDENCY_NAMES.some(
      (name) =>
        entry === name || entry.includes(`${name}@`) || entry === `npm:${name}`
    )
  )
}

/* @invariant A PROJECT MANIFEST ONE DIRECTORY UP IS NOT AUTOMATICALLY THIS
   EXTENSION'S PROJECT. A bare manifest.json in a folder nested inside an
   unrelated repository sits exactly where `src/manifest.json` sits in the
   documented layout, so position alone cannot tell them apart. Adopting the
   stranger meant its `dist/` received the build, its `scripts/`, `pages/` and
   `public/` folders became build inputs, and an install could run in it. */
export function ownsManifest(
  projectManifestPath: string,
  manifestPath: string
): boolean {
  const projectDir = path.resolve(path.dirname(projectManifestPath))
  const manifestDir = path.resolve(path.dirname(manifestPath))

  if (projectDir === manifestDir) return true

  // The documented layout: <project>/package.json with <project>/src/manifest.json.
  if (
    path.basename(manifestDir) === 'src' &&
    path.dirname(manifestDir) === projectDir
  ) {
    return true
  }

  if (declaresExtension(projectManifestPath)) return true

  return EXTENSION_CONFIG_FILENAMES.some((filename) =>
    fs.existsSync(path.join(projectDir, filename))
  )
}

function realOrResolved(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return path.resolve(target)
  }
}

function isAtOrBelow(baseDir: string, candidateDir: string): boolean {
  const rel = path.relative(
    realOrResolved(baseDir),
    realOrResolved(candidateDir)
  )

  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

// One line per declined root per run: the resolution is asked for repeatedly
// in a single command, and the reader only needs to be told once.
const announcedDeclinedRoots = new Set<string>()

function announceDeclinedProjectRoot(
  projectManifestPath: string,
  manifestPath: string,
  log: (line: string) => void,
  quiet: boolean
): void {
  // A quiet resolution prints nothing, so it must not use up the one line.
  if (quiet) return

  const key = `${path.resolve(projectManifestPath)}::${path.resolve(manifestPath)}`
  if (announcedDeclinedRoots.has(key)) return

  announcedDeclinedRoots.add(key)
  log(messages.declinedProjectRoot(projectManifestPath, manifestPath))
}

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

// go-git-it prints its git version and an unauthenticated GitHub API
// rate-limit warning on its own. Neither is a user decision, so both stay
// behind --debug like the rest of the tool's chatter.
async function withSuppressedOutput<T>(task: () => Promise<T>): Promise<T> {
  if (isDebug()) return task()

  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)

  process.stdout.write = (() => true) as typeof process.stdout.write
  process.stderr.write = (() => true) as typeof process.stderr.write

  try {
    return await task()
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }
}

// A codeload archive url per candidate ref, shortest first. Only the remote
// knows where a ref ends, so a branch name carrying a slash is a later try.
export function githubZipCandidates(pathOrRemoteUrl: string): Array<{
  zipUrl: string
  ref: string
  subdir: string
}> {
  const segments = new URL(pathOrRemoteUrl).pathname.split('/').filter(Boolean)
  const [owner, repo] = segments
  const treeIndex = segments.indexOf('tree')

  // No tree/ in the url means the repo's default branch, which codeload
  // serves under its name like any other ref.
  if (treeIndex === -1 || segments.length <= treeIndex + 1) {
    return [
      {
        zipUrl: `https://codeload.github.com/${owner}/${repo}/zip/main`,
        ref: 'main',
        subdir: ''
      }
    ]
  }

  const after = segments.slice(treeIndex + 1)
  // A ref of three segments is already generous for `release/2024/beta`.
  const maxRefLength = Math.min(after.length, 3)
  const candidates = []

  for (let length = 1; length <= maxRefLength; length++) {
    const ref = after.slice(0, length).join('/')

    candidates.push({
      // The ref-agnostic form resolves a tag, a branch and a commit alike,
      // where refs/heads/<ref> could only ever resolve a branch.
      zipUrl: `https://codeload.github.com/${owner}/${repo}/zip/${ref}`,
      ref,
      subdir: after.slice(length).join('/')
    })
  }

  return candidates
}

// codeload flattens the ref's slashes and strips a tag's leading `v` in the
// archive root name, so a lone directory in a fresh extraction is the root.
function resolveRepoRoot(extractedPath: string, repo: string, ref: string) {
  const directories = fs
    .readdirSync(extractedPath, {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const named = directories.find((name) =>
    name.startsWith(`${repo}-${ref.replace(/\//g, '-')}`)
  )

  if (named) return path.join(extractedPath, named)
  if (directories.length === 1) return path.join(extractedPath, directories[0])

  return extractedPath
}

async function importUrlSourceFromGithub(
  pathOrRemoteUrl: string,
  text: string
): Promise<{projectPath: string; downloaded: boolean}> {
  // Clone into the current working directory. go-git-it creates a subfolder
  // typically matching the repo name (or last segment for tree URLs).
  const cwd = process.cwd()
  const url = new URL(pathOrRemoteUrl)
  const segments = url.pathname.split('/').filter(Boolean)
  const repoName =
    segments.length >= 2 ? segments[1] : segments[segments.length - 1]
  const treeIndex = segments.indexOf('tree')

  const expectedName =
    treeIndex !== -1 && segments.length > treeIndex + 2
      ? segments[segments.length - 1]
      : repoName

  const expectedPath = path.resolve(cwd, expectedName)
  const {
    assertDestinationIsOurs,
    readRemoteSource,
    sourceKey,
    writeRemoteSource
  } = await import('./zip')

  // A folder of the right name is this url's download only when stamped as
  // one. An empty one is cleared so go-git-it does not fail with ENOTEMPTY.
  assertDestinationIsOurs(expectedPath, pathOrRemoteUrl)

  if (fs.existsSync(expectedPath)) {
    // Reused, not refetched: a clone lands here to be edited and dev watches
    // it, so refetching on every restart would delete the user's work.
    if (readRemoteSource(expectedPath) === sourceKey(pathOrRemoteUrl)) {
      return {projectPath: expectedPath, downloaded: false}
    }

    fs.rmSync(expectedPath, {recursive: true, force: true})
  }

  async function tryGitClone() {
    const {default: goGitIt} = await import('go-git-it')
    // go-git-it echoes the progress text itself, but that echo is silenced
    // with the rest of its output, so the user still sees activity from here.
    if (!isDebug()) console.log(text)

    // The timeout races inside the silencer so a hung clone restores stdout
    // before the timeout error has to print.
    await withSuppressedOutput(() =>
      withTimeout(
        goGitIt(pathOrRemoteUrl, cwd, text),
        REMOTE_FETCH_TIMEOUT_MS,
        pathOrRemoteUrl
      )
    )
  }

  async function tryZipFallback() {
    const repo = segments[1]
    const candidateRefs = githubZipCandidates(pathOrRemoteUrl)
    // The single-segment reading is what the url almost always means, so its
    // failure is the one worth reporting if every reading misses.
    let firstError: unknown

    // A tag, a commit and a branch all answer on /zip/<ref>, so a miss here
    // means this reading of the ref was wrong, not that the url was.
    for (const candidate of candidateRefs) {
      try {
        const extractedPath = await importUrlSourceFromZip(candidate.zipUrl)
        const repoRoot = resolveRepoRoot(extractedPath, repo, candidate.ref)

        if (!candidate.subdir) return repoRoot

        const withSubdir = path.join(repoRoot, candidate.subdir)

        if (fs.existsSync(withSubdir)) return withSubdir

        throw new Error(
          messages.downloadedProjectFolderNotFound(repoRoot, [candidate.subdir])
        )
      } catch (error) {
        firstError = firstError ?? error
      }
    }

    throw firstError
  }

  const dirsBefore = new Set(listDirectories(cwd))

  try {
    await tryGitClone()
  } catch {
    const fallbackPath = await tryZipFallback()
    writeRemoteSource(fallbackPath, pathOrRemoteUrl)

    return {projectPath: fallbackPath, downloaded: true}
  }

  const candidates: string[] = []

  if (treeIndex !== -1 && segments.length > treeIndex + 2) {
    candidates.push(segments[segments.length - 1])
  }

  candidates.push(repoName)

  // Only a folder this run created can be the clone: anything that was
  // already here is a stranger's, whatever it is called.
  const appeared = listDirectories(cwd).filter((name) => !dirsBefore.has(name))

  const landed = (() => {
    for (const name of candidates) {
      const candidatePath = path.resolve(cwd, name)

      if (appeared.includes(name)) return candidatePath
    }

    for (const name of appeared) {
      if (fs.existsSync(path.join(cwd, name, 'manifest.json'))) {
        return path.join(cwd, name)
      }
    }

    const ghRoot = appeared.find((name) => /-main$|-master$/.test(name))

    return ghRoot ? path.join(cwd, ghRoot) : undefined
  })()

  if (!landed) {
    throw new Error(messages.downloadedProjectFolderNotFound(cwd, candidates))
  }

  writeRemoteSource(landed, pathOrRemoteUrl)

  return {projectPath: landed, downloaded: true}
}

function listDirectories(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, {withFileTypes: true})
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
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

      const [owner, project] = url.pathname.split('/').slice(1, 3)
      const projectName = path.basename(url.pathname)

      const {projectPath, downloaded} = await importUrlSourceFromGithub(
        pathOrRemoteUrl,
        messages.downloadingProjectPath(
          projectName,
          `https://github.com/${owner}/${project}`
        )
      )

      console.log(
        downloaded
          ? messages.creatingProjectPath()
          : messages.reusingDownloadedProject(projectPath, pathOrRemoteUrl)
      )

      return projectPath
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

// Companion extensions live under extensions/ and load next to the project,
// so a manifest there is the project's own only when nothing else is.
const COMPANION_EXTENSIONS_DIR = 'extensions'

// The companions Extension.js ships and loads itself. Never a user project.
const BUILT_IN_COMPANION_NAMES: ReadonlySet<string> = new Set([
  'extension-js-devtools',
  'extension-js-theme'
])

const ALWAYS_SKIPPED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'public'
])

const BUILD_OUTPUT_DIRS: ReadonlySet<string> = new Set([
  'build',
  'out',
  'coverage'
])

const MANIFEST_SCAN_SKIP_DIRS: ReadonlySet<string> = new Set([
  ...ALWAYS_SKIPPED_DIRS,
  ...BUILD_OUTPUT_DIRS,
  COMPANION_EXTENSIONS_DIR
])

function isManifestScanDir(
  entry: fs.Dirent,
  skipDirs: ReadonlySet<string> = MANIFEST_SCAN_SKIP_DIRS
): boolean {
  return (
    entry.isDirectory() &&
    !entry.name.startsWith('.') &&
    !skipDirs.has(entry.name)
  )
}

function collectManifestCandidates(
  rootDir: string,
  maxDepth: number
): string[] {
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

      if (isManifestScanDir(entry)) {
        walk(path.join(dir, entry.name), depth + 1)
      }
    }
  }

  walk(rootDir, 0)

  return results
}

function findCompanionManifests(projectPath: string): string[] {
  return collectManifestCandidates(
    path.join(projectPath, COMPANION_EXTENSIONS_DIR),
    2
  )
}

function isBuiltInCompanionManifest(manifestPath: string): boolean {
  return path
    .dirname(manifestPath)
    .split(path.sep)
    .some((segment) => BUILT_IN_COMPANION_NAMES.has(segment))
}

// A project whose one extension sits under extensions/ has no other manifest
// to be a companion to. Several of them, or a built-in one, stay companions.
function findLoneExtensionUnderCompanionDir(
  projectPath: string
): string | undefined {
  const manifests = findCompanionManifests(projectPath)

  return manifests.length === 1 && !isBuiltInCompanionManifest(manifests[0])
    ? manifests[0]
    : undefined
}

export async function getProjectStructure(
  pathOrRemoteUrl: string | undefined
): Promise<ProjectStructure> {
  const projectPath = await getProjectPath(pathOrRemoteUrl)

  return resolveProjectStructureSync(projectPath)
}

// The same walk `dev` anchors its session on, usable by the read-only
// session tools: local path in, manifest and project root out, no network.
export function resolveProjectStructureSync(
  projectPath: string,
  options: {quiet?: boolean} = {}
): ProjectStructure {
  const log = (line: string) => {
    if (!options.quiet) console.log(line)
  }

  const isUnderDir = (baseDir: string, candidatePath: string): boolean => {
    const rel = path.relative(baseDir, candidatePath)

    return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel))
  }

  const packageJsonPathFromProject = findNearestPackageJsonSync(
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
    const missingManifestError = (candidates: string[] = []) => {
      const companionManifest = candidates.length
        ? undefined
        : findCompanionManifests(projectPath)[0]

      if (companionManifest) {
        return codedError(
          CODES.E_COMPANION_EXTENSION_PATH,
          messages.companionManifestNotProjectError(
            manifestPath,
            companionManifest
          )
        )
      }

      // A folder that is not there at all is a different mistake from a folder
      // that is there without a manifest, and only the code can say which.
      return codedError(
        fs.existsSync(projectPath)
          ? CODES.E_MANIFEST_NOT_FOUND
          : CODES.E_PROJECT_NOT_FOUND,
        messages.manifestNotFoundError(manifestPath, candidates)
      )
    }

    if (packageJsonDirFromProject) {
      const absoluteCandidates = collectManifestCandidates(projectPath, 3)
      const relativeCandidates = absoluteCandidates.map(
        (candidate) => path.relative(projectPath, candidate) || candidate
      )

      const adopted =
        absoluteCandidates.length === 1
          ? absoluteCandidates[0]
          : absoluteCandidates.length === 0
            ? findLoneExtensionUnderCompanionDir(projectPath)
            : undefined

      if (adopted) {
        manifestPath = adopted
        log(messages.resolvedWorkspaceManifest(projectPath, manifestPath))
      } else {
        throw missingManifestError(relativeCandidates)
      }
    } else {
      const MAX_DEPTH = 5

      const findManifest = (
        dir: string,
        depth: number,
        skipDirs?: ReadonlySet<string>
      ): string | null => {
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

          if (isManifestScanDir(file, skipDirs)) {
            const found = findManifest(
              path.join(dir, file.name),
              depth + 1,
              skipDirs
            )
            if (found) return found
          }
        }

        return null
      }

      // Source folders win. A lone extension under extensions/ comes next, and
      // a folder named like build output is only read when nothing else is.
      const foundManifest =
        findManifest(projectPath, 0) ||
        findLoneExtensionUnderCompanionDir(projectPath) ||
        findManifest(
          projectPath,
          0,
          new Set([...ALWAYS_SKIPPED_DIRS, COMPANION_EXTENSIONS_DIR])
        )

      if (foundManifest) {
        manifestPath = foundManifest
      } else {
        throw missingManifestError()
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
      ) {
        return undefined
      }

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
      log(messages.resolvedWorkspaceManifest(projectPath, manifestPath))
    } else {
      throw codedError(
        CODES.E_MANIFEST_INVALID,
        messages.notAnExtensionManifestError(manifestPath)
      )
    }
  }

  // Find nearest package.json and deno.json(c); web-only mode only applies
  // when neither is present or valid.
  const packageJsonPath = findNearestPackageJsonSync(manifestPath)
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
        throw codedError(
          CODES.E_MANIFEST_IN_PUBLIC,
          messages.manifestNotFoundError(fallbackRoot)
        )
      }
    }
  }

  // A project manifest that does not own this extension is a stranger's
  // project the manifest merely sits inside, so the manifest folder is the
  // project. Declining here is what keeps its dist, its special folders and
  // its install out of the picture, since every one of those keys off this.
  // Only a project manifest ABOVE the folder the command was pointed at can
  // be a stranger's. One at or below it is the project the author named.
  const owns = (projectManifestPath: string) =>
    isAtOrBelow(projectPath, path.dirname(projectManifestPath)) ||
    ownsManifest(projectManifestPath, manifestPath)
  const ownedPackageJsonPath =
    packageJsonPath && owns(packageJsonPath) ? packageJsonPath : undefined
  const ownedDenoJsonPath =
    denoJsonPath && owns(denoJsonPath) ? denoJsonPath : undefined
  const declined = packageJsonPath || denoJsonPath

  if (declined && !ownedPackageJsonPath && !ownedDenoJsonPath) {
    announceDeclinedProjectRoot(
      declined,
      manifestPath,
      log,
      Boolean(options.quiet)
    )
  }

  if (!ownedPackageJsonPath || !validatePackageJson(ownedPackageJsonPath)) {
    // No (valid) package.json: a Deno-manifest project is still a full project;
    // only with no manifest at all do we fall back to web-only mode.
    return {
      manifestPath,
      ...(ownedDenoJsonPath ? {denoJsonPath: ownedDenoJsonPath} : {})
    }
  }

  return {
    manifestPath,
    packageJsonPath: ownedPackageJsonPath,
    ...(ownedDenoJsonPath ? {denoJsonPath: ownedDenoJsonPath} : {})
  }
}

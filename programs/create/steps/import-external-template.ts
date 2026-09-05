//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {existsSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import axios from 'axios'
import {unzipSync} from 'fflate'
import goGitIt from 'go-git-it'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'
import * as utils from '../lib/utils'

// In-process unzip with a zip-slip guard: entries naming absolute paths or
// escaping the destination throw, and symlink entries are never materialized
// as symlinks, so a hostile template archive cannot write outside its dir.
async function extractZipBufferTo(
  zipBuffer: Buffer,
  destinationDir: string
): Promise<void> {
  const root = path.resolve(destinationDir)
  const entries = unzipSync(new Uint8Array(zipBuffer))

  await fs.mkdir(root, {recursive: true})

  for (const [name, data] of Object.entries(entries)) {
    const normalized = name.replace(/\\/g, '/')
    const target = path.resolve(root, normalized)
    const relative = path.relative(root, target)

    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Refusing to extract zip entry outside the destination: ${name}`
      )
    }

    if (normalized.endsWith('/')) {
      await fs.mkdir(target, {recursive: true})
      continue
    }

    await fs.mkdir(path.dirname(target), {recursive: true})
    await fs.writeFile(target, data)
  }
}

const NETWORK_TIMEOUT_MS = (() => {
  const raw = parseInt(
    String(process.env.EXTENSION_CREATE_TIMEOUT_MS || ''),
    10
  )
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000
})()

// codeload serves a repo archive per ref namespace: a commit at /zip/<sha>, a tag
// at /zip/refs/tags/<tag>, a branch at /zip/refs/heads/<branch>.
const CODELOAD_BASE = 'https://codeload.github.com/extension-js/examples/zip'

// The default corpus is PINNED to an immutable commit, so two scaffolds of the
// same template always match and the shipped CLI never tracks a moving branch.
// The commit must be an ancestor of the corpus branch: 4.0.30 shipped pinned to
// an unreachable bot commit that GitHub happened to still serve.
// Move it with `node scripts/generate-template-corpus.mjs --ref <sha>`, which
// regenerates the name list the CLI advertises from the same commit.
// EXTENSION_CREATE_TEMPLATE_REF=main restores floating.
export const DEFAULT_TEMPLATES_REF = 'cb6a25377bd9516a1e55447a2010537019851ab2'

// The one template that ships inside the npm package, so it scaffolds with no
// network call. The help text derives its "no network" promise from this list
// rather than restating it, a default that is not bundled must not claim it.
export const BUNDLED_TEMPLATES: readonly string[] = ['javascript']

// The template scaffolded when `--template` is omitted. TypeScript is the
// default across the toolchain (CLI and MCP alike), so it downloads like every
// other catalog name rather than shipping in the package.
export const DEFAULT_TEMPLATE_NAME = 'typescript'

// What a create falls back to when the default's download fails because the
// machine is offline. It is a bundled template so the fallback needs no network,
// and the swap is always named (never silent), so "javascript ran" can only ever
// mean the network was down, which keeps the offline claim falsifiable.
export const OFFLINE_FALLBACK_TEMPLATE = 'javascript'

// Map EXTENSION_CREATE_TEMPLATE_REF to the codeload URL(s) that can resolve it, so
// a commit SHA or tag pins the corpus reproducibly and not only a branch. A bare
// name is branch-or-tag ambiguous, so try branch first (the historical default,
// keeping a plain `main` fetch to one request), then tag.
export function resolveCatalogUrls(
  ref: string,
  overrideUrl?: string
): string[] {
  if (overrideUrl) return [overrideUrl]
  if (/^refs\/(heads|tags)\//.test(ref)) return [`${CODELOAD_BASE}/${ref}`]
  // A full 40-hex SHA is an unambiguous commit; codeload serves it bare.
  if (/^[0-9a-f]{40}$/i.test(ref)) return [`${CODELOAD_BASE}/${ref}`]
  const urls: string[] = []
  // A short hex ref is probably an abbreviated SHA: try the commit namespace
  // first, then fall back to branch/tag in case it is really a ref name.
  if (/^[0-9a-f]{7,39}$/i.test(ref)) urls.push(`${CODELOAD_BASE}/${ref}`)
  urls.push(
    `${CODELOAD_BASE}/refs/heads/${ref}`,
    `${CODELOAD_BASE}/refs/tags/${ref}`
  )
  return urls
}

// Where a scaffold's files actually came from, so the created project can record
// exactly which corpus it was cut from (reproducibility). `source` is the
// resolved URL, or `bundled` for the local fallback; `ref` is the requested
// template ref when the examples catalog was used.
export interface TemplateProvenance {
  template: string
  source: string
  ref?: string
}

// Distinguish a genuinely-absent catalog slug from a download/timeout/rate-limit
// failure; the old path surfaced BOTH as "choose a valid template name" (#56).
// Names that used to be the template's own folder and now point at its
// current one. The new-tab templates were called `new*` until 2026-08-22, which
// read as the English word: `new-react` looked like a starter for new React
// projects rather than a React new-tab page. They are `newtab*` now, and every
// command, link and bookmark that still says `new-react` keeps working.
//
// This is the honest use of an alias: both names mean the SAME template. It
// must never point a name at different bytes.
export const TEMPLATE_ALIASES: Readonly<Record<string, string>> = {
  new: 'newtab',
  'new-browser-flags': 'newtab-browser-flags',
  'new-config-eslint': 'newtab-config-eslint',
  'new-config-prettier': 'newtab-config-prettier',
  'new-config-stylelint': 'newtab-config-stylelint',
  'new-crypto': 'newtab-crypto',
  'new-env': 'newtab-env',
  'new-less': 'newtab-less',
  'new-preact': 'newtab-preact',
  'new-react': 'newtab-react',
  'new-react-router': 'newtab-react-router',
  'new-sass': 'newtab-sass',
  'new-svelte': 'newtab-svelte',
  'new-typescript': 'newtab-typescript',
  'new-vue': 'newtab-vue'
}

// Only a bare catalog name is aliased. A URL or a filesystem path names bytes
// the caller chose, and rewriting either would be the redirection this
// mechanism exists NOT to do.
export function resolveTemplateAlias(name: string): string {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_ALIASES, name)
    ? TEMPLATE_ALIASES[name]
    : name
}

export class TemplateNotFoundError extends Error {
  readonly templateName: string
  constructor(templateName: string, cause?: unknown) {
    super(`template not found in catalog: ${templateName}`)
    this.name = 'TemplateNotFoundError'
    this.templateName = templateName
    if (cause) (this as {cause?: unknown}).cause = cause
  }
}

export class TemplateDownloadError extends Error {
  readonly templateName: string
  constructor(templateName: string, cause: unknown) {
    const msg = (cause as {message?: string})?.message ?? String(cause)
    super(msg)
    this.name = 'TemplateDownloadError'
    this.templateName = templateName
    ;(this as {cause?: unknown}).cause = cause
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Fetch a repo tarball over plain HTTP (codeload), NOT a git pack negotiation:
// no git child, so no credential-helper hang (#56). One retry with backoff.
async function downloadArchive(
  url: string,
  timeoutMs: number,
  attempts = 2
): Promise<Buffer> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const {data} = await axios.get(url, {
        responseType: 'arraybuffer',
        maxRedirects: 5,
        timeout: timeoutMs,
        headers: {'User-Agent': 'extension-create'}
      })
      return Buffer.from(data)
    } catch (error) {
      lastError = error
      // A deterministic 4xx (a ref that does not exist) will not change on a
      // retry; only back off for network errors, rate limits, and 5xx.
      const status = (error as {response?: {status?: number}})?.response?.status
      const retriable = status === undefined || status === 429 || status >= 500
      if (attempt >= attempts || !retriable) break
      await sleep(400 * attempt)
    }
  }
  throw lastError
}

// Extract ONLY `<archive-root>/examples/<templateName>/**` from a GitHub zip
// into projectPath. Throws TemplateNotFoundError when the slug is absent.
export async function extractExamplesTemplateFromZip(
  zipBuffer: Buffer,
  templateName: string,
  projectPath: string
): Promise<number> {
  const entries = Object.entries(unzipSync(new Uint8Array(zipBuffer)))
  if (!entries.length) {
    throw new TemplateNotFoundError(templateName, new Error('empty archive'))
  }
  // GitHub archives wrap everything in a single top dir (e.g. `examples-main/`).
  const archiveRoot = entries[0][0].split('/')[0]
  const wanted = `${archiveRoot}/examples/${templateName}/`
  const files = entries.filter(
    ([name]) => !name.endsWith('/') && name.startsWith(wanted)
  )
  if (!files.length) throw new TemplateNotFoundError(templateName)

  const root = path.resolve(projectPath)
  let written = 0
  for (const [name, data] of files) {
    const rel = name.slice(wanted.length)
    if (!rel) continue
    const dest = path.resolve(root, rel)
    const relative = path.relative(root, dest)
    // Zip-slip guard: a hostile archive must not write outside the project.
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Refusing to extract zip entry outside the destination: ${name}`
      )
    }
    await fs.mkdir(path.dirname(dest), {recursive: true})
    await fs.writeFile(dest, data)
    written++
  }
  return written
}

// The #56 built-in-template path: pull the examples repo tarball over HTTP and
// unpack just the requested template, so catalog slugs scaffold without git.
async function importFromExamplesCatalog(
  templateName: string,
  projectPath: string
): Promise<{source: string; ref?: string}> {
  const ref = process.env.EXTENSION_CREATE_TEMPLATE_REF || DEFAULT_TEMPLATES_REF
  const overrideUrl = process.env.EXTENSION_CREATE_TEMPLATE_URL || undefined
  const urls = resolveCatalogUrls(ref, overrideUrl)

  let buffer: Buffer | undefined
  let source: string | undefined
  let lastError: unknown
  // Try each candidate namespace; only a download failure falls through, so a
  // present-but-missing slug still surfaces as TemplateNotFoundError below.
  for (const candidate of urls) {
    try {
      buffer = await downloadArchive(candidate, NETWORK_TIMEOUT_MS)
      source = candidate
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!buffer || !source)
    throw new TemplateDownloadError(templateName, lastError)
  await extractExamplesTemplateFromZip(buffer, templateName, projectPath)
  // An explicit URL override is its own provenance; otherwise record the ref.
  return {source, ref: overrideUrl ? undefined : ref}
}

function isAuthorOrDevMode(): boolean {
  return process.env.EXTENSION_ENV === 'development' || isDebug()
}

async function withTimeout<T>(
  task: Promise<T>,
  ms: number,
  onTimeout: () => Error
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms)
  })

  try {
    return await Promise.race([task, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function withSuppressedOutput<T>(task: () => Promise<T>): Promise<T> {
  // Keep the underlying tool's output in dev/author mode, silencing it there
  // hides the very diagnostics we want while working on the CLI.
  if (isAuthorOrDevMode()) return task()

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

function bundledTemplateDir(templateName: string): string {
  return path.join(__dirname, '..', 'templates', templateName)
}

// Copy a bundled template into projectPath, returning its provenance, or
// undefined when the template is not actually bundled on disk. Shared by the
// primary bundled path and the offline fallback so the two cannot drift.
async function copyBundledTemplate(
  templateName: string,
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void},
  ownerGitignore: string | null = null
): Promise<TemplateProvenance | undefined> {
  const localTemplate = bundledTemplateDir(templateName)
  if (!existsSync(localTemplate)) return undefined
  await utils.copyDirectoryWithSymlinks(localTemplate, projectPath)
  await restoreOwnerGitignore(projectPath, ownerGitignore)
  await removeTemplateScaffoldingFiles(projectPath)
  const dropped = await removeStaleTemplateLockfiles(projectPath)
  if (dropped.length) {
    logger.log(messages.removedStaleTemplateLockfiles(dropped))
  }
  return {template: templateName, source: 'bundled'}
}

// Gallery + E2E files the extension-js/examples repo carries; useless in a
// scaffolded project (template.spec.ts even trips tsc --noEmit). Issue #476.
export const TEMPLATE_SCAFFOLDING_FILES = [
  'template.meta.json',
  'template.spec.ts',
  'screenshot.png'
]

export async function removeTemplateScaffoldingFiles(
  projectPath: string
): Promise<void> {
  await Promise.all(
    TEMPLATE_SCAFFOLDING_FILES.map((name) =>
      fs.rm(path.join(projectPath, name), {force: true})
    )
  )
}

// Every lockfile flavor a template could commit upstream. The scaffolder
// injects `extension` into devDependencies AFTER the copy, so a copied
// lockfile is stale by design and turns `npm ci` from working into failing.
export const TEMPLATE_LOCKFILE_NAMES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'deno.lock'
]

// Strip root-level lockfiles from the copied template and report which ones
// were removed, so the caller can print one notice only when it applies.
export async function removeStaleTemplateLockfiles(
  projectPath: string
): Promise<string[]> {
  const removed: string[] = []
  for (const name of TEMPLATE_LOCKFILE_NAMES) {
    const target = path.join(projectPath, name)
    if (existsSync(target)) {
      await fs.rm(target, {force: true})
      removed.push(name)
    }
  }
  return removed
}

function getArchiveBaseName(url: string): string {
  const withoutQuery = url.split('?')[0]
  const fileName = path.basename(withoutQuery)

  if (!fileName.toLowerCase().endsWith('.zip')) return fileName

  return fileName.slice(0, -4)
}

async function getZipSourcePath(
  tempPath: string,
  templateUrl: string
): Promise<string> {
  const archiveBase = getArchiveBaseName(templateUrl)
  let entries: Array<{isDirectory: () => boolean; name: string}> = []

  try {
    entries = await fs.readdir(tempPath, {withFileTypes: true})
  } catch {
    return tempPath
  }

  const dirs = entries.filter((entry) => entry.isDirectory())
  if (dirs.length !== 1) return tempPath

  const onlyDir = dirs[0]
  // Common release archives wrap files in <name>.<browser>/.
  if (onlyDir.name === archiveBase) return path.join(tempPath, onlyDir.name)
  return tempPath
}

export interface ImportExternalTemplateOptions {
  // True when the scaffolder created projectPath in this run (the caller's
  // createDirectory step knows). Failure cleanup may then remove the whole
  // directory; otherwise it removes only the entries this import added.
  ownsProjectDir?: boolean
  // True only when the caller applied the default template (no explicit
  // --template). A download failure then scaffolds the bundled offline
  // fallback instead of failing, so an offline machine can still create. An
  // explicit template that fails to download still fails loudly.
  allowOfflineFallback?: boolean
}

// Failure cleanup must never delete a directory the scaffolder did not create
// and never pre-existing user content (`extension create .` in a real repo
// once lost .git to a transient download failure).
export async function cleanupFailedImport(
  projectPath: string,
  ownsProjectDir: boolean,
  preExistingEntries: string[]
): Promise<void> {
  if (ownsProjectDir) {
    await fs.rm(projectPath, {recursive: true, force: true}).catch(() => {})
    return
  }

  const keep = new Set(preExistingEntries)
  let entries: string[] = []
  try {
    entries = await fs.readdir(projectPath)
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((entry) => !keep.has(entry))
      .map((entry) =>
        fs
          .rm(path.join(projectPath, entry), {recursive: true, force: true})
          .catch(() => {})
      )
  )
}

// A template copy replaces files by name. An owner's .gitignore keeps its
// rules: the template's lines it lacks are appended after the copy.
async function readOwnerGitignore(projectPath: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(projectPath, '.gitignore'), 'utf8')
  } catch {
    return null
  }
}

async function restoreOwnerGitignore(
  projectPath: string,
  ownerContents: string | null
): Promise<void> {
  if (ownerContents === null) return
  const target = path.join(projectPath, '.gitignore')
  let templateContents = ''
  try {
    templateContents = await fs.readFile(target, 'utf8')
  } catch {
    // The template shipped no .gitignore, the owner's file is untouched.
    await fs.writeFile(target, ownerContents)
    return
  }
  const ownerLines = new Set(
    ownerContents.split(/\r?\n/).map((line) => line.trim())
  )
  const added = templateContents
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !ownerLines.has(line.trim()))
  const merged =
    added.length === 0
      ? ownerContents
      : `${ownerContents.replace(/\n?$/, '\n')}\n# extension.js template rules\n${added.join('\n')}\n`
  await fs.writeFile(target, merged)
}

export async function importExternalTemplate(
  projectPath: string,
  projectName: string,
  template: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void},
  options?: ImportExternalTemplateOptions
): Promise<TemplateProvenance> {
  const templateName = path.basename(template)
  const resolvedTemplate = template

  const isHttp = /^https?:\/\//i.test(template)
  const isGithub = /^https?:\/\/github\.com\//i.test(template)

  // A renamed template keeps answering to the name it shipped under. A URL
  // names bytes the caller chose, so it is left exactly as given; anything
  // else is resolved through the catalog, which takes only the BASENAME
  // (`templateName` above) and discards the directory. A separator therefore
  // changes nothing about which entry is fetched, and gating the alias on it
  // made `examples/new-react` fail as unknown while `examples/newtab-react`
  // and a bare `new-react` both worked.
  const namesCatalogEntry = !isHttp
  const resolvedTemplateName = namesCatalogEntry
    ? resolveTemplateAlias(templateName)
    : templateName

  // The caller may have mkdir'd projectPath already, so a plain existsSync
  // here cannot prove ownership; the explicit option wins when provided.
  const dirExistedBeforeImport = existsSync(projectPath)
  const ownsProjectDir = options?.ownsProjectDir ?? !dirExistedBeforeImport
  let preExistingEntries: string[] = []
  if (dirExistedBeforeImport) {
    try {
      preExistingEntries = await fs.readdir(projectPath)
    } catch {
      // Ignore
    }
  }

  const ownerGitignore = dirExistedBeforeImport
    ? await readOwnerGitignore(projectPath)
    : null

  try {
    await fs.mkdir(projectPath, {recursive: true})

    if (!isHttp && !isGithub && BUNDLED_TEMPLATES.includes(resolvedTemplate)) {
      const provenance = await copyBundledTemplate(
        resolvedTemplate,
        projectPath,
        logger,
        ownerGitignore
      )
      if (provenance) return provenance
      // Bundled copy missing (unexpected): fall through to the network fetch
    }

    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'extension-js-create-')
    )
    const tempPath = path.join(tempRoot, `${projectName}-temp`)
    await fs.mkdir(tempPath, {recursive: true})

    const runGoGitIt = async (templatePath: string, destination: string) => {
      // Harden the spawned git so a credential-helper prompt can't hang it
      // (#56, `GIT_TERMINAL_PROMPT=0`). go-git-it's execFile inherits process.env.
      const gitEnvKeys = {
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        GCM_INTERACTIVE: 'never'
      }
      const savedEnv: Record<string, string | undefined> = {}
      for (const [k, v] of Object.entries(gitEnvKeys)) {
        savedEnv[k] = process.env[k]
        process.env[k] = v
      }
      try {
        await withTimeout(
          withSuppressedOutput(async () =>
            goGitIt(
              templatePath,
              destination,
              messages.installingFromTemplate(projectName, templateName)
            )
          ),
          NETWORK_TIMEOUT_MS,
          () =>
            new Error(
              messages.templateFetchTimedOut(templateName, NETWORK_TIMEOUT_MS)
            )
        )
      } finally {
        for (const [k, v] of Object.entries(savedEnv)) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
      }
    }

    let provenance: TemplateProvenance
    if (isGithub) {
      await runGoGitIt(template, tempPath)
      const candidates = await fs.readdir(tempPath, {withFileTypes: true})
      const preferred = candidates.find(
        (d) => d.isDirectory() && d.name === templateName
      )
      const srcPath = preferred ? path.join(tempPath, templateName) : tempPath
      await utils.moveDirectoryContents(srcPath, projectPath)
      provenance = {template: resolvedTemplateName, source: template}
    } else if (isHttp) {
      const {data, headers} = await axios.get(template, {
        responseType: 'arraybuffer',
        maxRedirects: 5,
        timeout: NETWORK_TIMEOUT_MS
      })
      const contentType = String(headers?.['content-type'] || '')
      const looksZip =
        /zip|octet-stream/i.test(contentType) ||
        template.toLowerCase().endsWith('.zip')
      if (!looksZip) {
        throw new Error(
          `Remote template does not appear to be a ZIP archive: ${template}`
        )
      }
      await extractZipBufferTo(Buffer.from(data), tempPath)
      const sourcePath = await getZipSourcePath(tempPath, template)
      await utils.moveDirectoryContents(sourcePath, projectPath)
      provenance = {template: resolvedTemplateName, source: template}
    } else {
      // Built-in template names resolve to one folder in the extension-js/
      // examples catalog, fetched as an HTTP tarball; no git, one template (#56).
      const catalog = await importFromExamplesCatalog(
        resolvedTemplateName,
        projectPath
      )
      provenance = {
        template: resolvedTemplateName,
        source: catalog.source,
        ...(catalog.ref ? {ref: catalog.ref} : {})
      }
    }

    await restoreOwnerGitignore(projectPath, ownerGitignore)
    await removeTemplateScaffoldingFiles(projectPath)
    const droppedLockfiles = await removeStaleTemplateLockfiles(projectPath)
    if (droppedLockfiles.length) {
      logger.log(messages.removedStaleTemplateLockfiles(droppedLockfiles))
    }

    await fs.rm(tempRoot, {recursive: true, force: true})

    return provenance
  } catch (error) {
    // The default template downloads, so an offline machine cannot fetch it. A
    // download failure on the default falls back to the bundled template rather
    // than failing the whole create, and the swap is named below so it is never
    // silent. A missing slug (TemplateNotFoundError) is a typo, not a network
    // outage, and must not be answered with a different template.
    if (
      error instanceof TemplateDownloadError &&
      options?.allowOfflineFallback &&
      resolvedTemplate !== OFFLINE_FALLBACK_TEMPLATE &&
      BUNDLED_TEMPLATES.includes(OFFLINE_FALLBACK_TEMPLATE)
    ) {
      await cleanupFailedImport(projectPath, ownsProjectDir, preExistingEntries)
      await fs.mkdir(projectPath, {recursive: true})
      const fallback = await copyBundledTemplate(
        OFFLINE_FALLBACK_TEMPLATE,
        projectPath,
        logger,
        ownerGitignore
      )
      if (fallback) {
        logger.log(
          messages.templateOfflineFallback(
            resolvedTemplateName,
            OFFLINE_FALLBACK_TEMPLATE,
            error
          )
        )
        return fallback
      }
    }
    // Distinguish a genuinely-missing slug from a download/timeout/rate-limit
    // failure; the old path reported every failure as a bad template name (#56).
    if (error instanceof TemplateNotFoundError) {
      logger.error(
        messages.templateNotFoundInCatalog(
          templateName,
          (error as {cause?: unknown}).cause
        )
      )
    } else if (error instanceof TemplateDownloadError) {
      logger.error(messages.templateDownloadFailed(templateName, error))
    } else {
      logger.error(messages.installingFromTemplateError(templateName, error))
    }
    // Clean the partial scaffold so a retry into the same name is not
    // poisoned, without ever touching content that pre-existed this run.
    await cleanupFailedImport(projectPath, ownsProjectDir, preExistingEntries)
    throw error
  }
}

//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {existsSync, realpathSync, statSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import axios from 'axios'
import {unzipSync} from 'fflate'
import goGitIt from 'go-git-it'
import * as messages from '../lib/messages'
import {hasChannelPrefix, isDebug} from '../lib/messaging'
import * as utils from '../lib/utils'

// In-process unzip with a zip-slip guard: entries naming absolute paths or
// escaping the destination throw, and symlink entries are never materialized
// as symlinks, so a hostile template archive cannot write outside its dir.
function escapesRoot(root: string, name: string): boolean {
  const target = path.resolve(root, name.replace(/\\/g, '/'))
  const relative = path.relative(root, target)

  return !relative || relative.startsWith('..') || path.isAbsolute(relative)
}

async function extractZipBufferTo(
  zipBuffer: Buffer,
  destinationDir: string,
  sourceUrl: string
): Promise<void> {
  const root = path.resolve(destinationDir)
  const entries = unzipRemoteArchive(zipBuffer, sourceUrl)

  // Every entry is vetted before the first write, so a refused archive
  // leaves nothing behind.
  for (const name of Object.keys(entries)) {
    if (escapesRoot(root, name)) throw entryOutsideDestination(name, sourceUrl)
  }

  await fs.mkdir(root, {recursive: true})

  for (const [name, data] of Object.entries(entries)) {
    const normalized = name.replace(/\\/g, '/')
    const target = path.resolve(root, normalized)

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
export const DEFAULT_TEMPLATES_REF = '2a8c4bae43ba6e883bf9ce7f6d108963ed162516'

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
// resolved URL, `bundled` for the local fallback or `local` for a directory; `ref` is the requested
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

export class InsecureTemplateUrlError extends Error {
  readonly url: string
  constructor(url: string) {
    super(`template URL is not https: ${url}`)
    this.name = 'InsecureTemplateUrlError'
    this.url = url
  }
}

// A template runs code on this machine at install time, and anyone on the
// network path can rewrite a plain HTTP download. Opting in is explicit.
export function isRefusedHttpTemplateUrl(url: string): boolean {
  if (process.env.EXTENSION_ALLOW_HTTP_TEMPLATE === 'true') return false

  return /^http:\/\//i.test(url)
}

// An https URL that redirects to http downgrades the same download, so the
// redirect is held to the rule the first URL was.
export function refuseHttpRedirect(options: {
  protocol?: string
  href?: string
}): void {
  const target = String(options.href || `${options.protocol || ''}//`)

  if (isRefusedHttpTemplateUrl(target)) {
    throw new InsecureTemplateUrlError(target)
  }
}

function findInsecureTemplateUrlError(
  error: unknown
): InsecureTemplateUrlError | null {
  let current: unknown = error

  for (let depth = 0; current && depth < 4; depth++) {
    if (current instanceof InsecureTemplateUrlError) return current

    current = (current as {cause?: unknown}).cause
  }

  return null
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

// The URL answered, with something that is not an archive. That is a URL to
// fix, so it never takes the network frame a failed download gets.
export class TemplateNotZipError extends Error {
  readonly url: string
  readonly got: string
  constructor(url: string, got: string) {
    super(`template URL did not answer with a ZIP archive: ${url}`)
    this.name = 'TemplateNotZipError'
    this.url = url
    this.got = got
  }
}

// The body opened like a ZIP and then would not unpack. It is still the URL's
// archive to fix, so it is typed and never reaches the sink with a stack.
export class TemplateArchiveDamagedError extends Error {
  readonly url: string
  readonly reason: string
  constructor(url: string, cause: unknown) {
    const reason = (cause as {message?: string})?.message ?? String(cause)
    super(`template archive is damaged: ${url}`)
    this.name = 'TemplateArchiveDamagedError'
    this.url = url
    this.reason = reason
    ;(this as {cause?: unknown}).cause = cause
  }
}

// An entry that would land outside the project is refused on purpose, and a
// retry fetches the same archive, so it is not reported as a damaged one.
export class TemplateArchiveEntryOutsideError extends Error {
  readonly url: string
  readonly entry: string
  constructor(url: string, entry: string) {
    super(`template archive has an entry outside its folder: ${entry}`)
    this.name = 'TemplateArchiveEntryOutsideError'
    this.url = url
    this.entry = entry
  }
}

function entryOutsideDestination(name: string, sourceUrl?: string): Error {
  return sourceUrl
    ? new TemplateArchiveEntryOutsideError(sourceUrl, name)
    : new Error(
        `Refusing to extract zip entry outside the destination: ${name}`
      )
}

function unzipRemoteArchive(zipBuffer: Buffer, sourceUrl?: string) {
  try {
    return unzipSync(new Uint8Array(zipBuffer))
  } catch (error) {
    if (!sourceUrl) throw error

    throw new TemplateArchiveDamagedError(sourceUrl, error)
  }
}

// Every ZIP opens with a local file, an empty archive or a spanned marker.
function isZipBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    return false
  }

  const marker = (buffer[2] << 8) | buffer[3]

  return marker === 0x0304 || marker === 0x0506 || marker === 0x0708
}

// What the server sent, for the GOT row. A ZIP content type over a body that
// is not one would otherwise read as the thing the refusal says is missing.
function describeNonZipResponse(contentType: string, body: Buffer): string {
  const type = contentType || 'unknown content type'

  if (body.length === 0) return `${type} with an empty body`

  return /zip|octet-stream/i.test(contentType)
    ? `${type} that is not ZIP data`
    : type
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One budget for the whole fetch, retries included, like the remote source
// fetch in develop. A per-attempt timeout let a silent server double it.
type FetchBudget = {deadline: number; ms: number}

function startFetchBudget(ms: number): FetchBudget {
  return {deadline: Date.now() + ms, ms}
}

function fetchBudgetSpent(budget: FetchBudget): Error {
  return new Error(
    `No answer within ${Math.round(budget.ms / 1000)} seconds (EXTENSION_CREATE_TIMEOUT_MS)`
  )
}

// The budget ran out, by the clock or by the abort it armed.
function budgetSpentBy(error: unknown, budget: FetchBudget): boolean {
  const code = (error as {code?: unknown} | null)?.code

  return (
    Date.now() >= budget.deadline ||
    code === 'ERR_CANCELED' ||
    code === 'ECONNABORTED'
  )
}

// Fetch a repo tarball over plain HTTP (codeload), NOT a git pack negotiation:
// no git child, so no credential-helper hang (#56). One retry with backoff.
async function downloadArchive(
  url: string,
  budget: FetchBudget,
  attempts = 2
): Promise<{body: Buffer; contentType: string}> {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const remaining = budget.deadline - Date.now()
    if (remaining <= 0) throw fetchBudgetSpent(budget)

    try {
      const {data, headers} = await axios.get(url, {
        responseType: 'arraybuffer',
        maxRedirects: 5,
        timeout: remaining,
        signal: AbortSignal.timeout(remaining),
        headers: {'User-Agent': 'extension-create'},
        beforeRedirect: refuseHttpRedirect
      })

      return {
        body: Buffer.from(data),
        contentType: String(headers?.['content-type'] || '')
      }
    } catch (error) {
      lastError = error
      if (findInsecureTemplateUrlError(error)) break
      if (budgetSpentBy(error, budget)) throw fetchBudgetSpent(budget)

      // A deterministic 4xx (a ref that does not exist) will not change on a
      // retry; only back off for network errors, rate limits, and 5xx.
      const status = (error as {response?: {status?: number}})?.response?.status
      const retriable = status === undefined || status === 429 || status >= 500
      if (attempt >= attempts || !retriable) break

      await sleep(Math.min(400 * attempt, budget.deadline - Date.now()))
    }
  }

  throw lastError
}

// Extract ONLY `<archive-root>/examples/<templateName>/**` from a GitHub zip
// into projectPath. Throws TemplateNotFoundError when the slug is absent.
export async function extractExamplesTemplateFromZip(
  zipBuffer: Buffer,
  templateName: string,
  projectPath: string,
  sourceUrl?: string
): Promise<number> {
  const entries = Object.entries(unzipRemoteArchive(zipBuffer, sourceUrl))

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

  // Zip-slip guard: a hostile archive must not write outside the project,
  // and every entry is vetted before the first write.
  for (const [name] of files) {
    const rel = name.slice(wanted.length)

    if (rel && escapesRoot(root, rel)) {
      throw entryOutsideDestination(name, sourceUrl)
    }
  }

  for (const [name, data] of files) {
    const rel = name.slice(wanted.length)
    if (!rel) continue

    const dest = path.resolve(root, rel)

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

  // The override feeds the same archive into the project, so it follows the
  // same https rule as a template URL passed on the command line.
  if (overrideUrl && isRefusedHttpTemplateUrl(overrideUrl)) {
    throw new InsecureTemplateUrlError(overrideUrl)
  }

  const urls = resolveCatalogUrls(ref, overrideUrl)
  const budget = startFetchBudget(NETWORK_TIMEOUT_MS)

  let buffer: Buffer | undefined
  let contentType = ''
  let source: string | undefined
  let lastError: unknown

  // Try each candidate namespace; only a download failure falls through, so a
  // present-but-missing slug still surfaces as TemplateNotFoundError below.
  for (const candidate of urls) {
    try {
      const reply = await downloadArchive(candidate, budget)
      buffer = reply.body
      contentType = reply.contentType
      source = candidate
      break
    } catch (error) {
      // A downgrade refusal is not a download failure, so it must not fall
      // back to the bundled template.
      const insecure = findInsecureTemplateUrlError(error)
      if (insecure) throw insecure

      lastError = error
    }
  }

  if (!buffer || !source) {
    throw new TemplateDownloadError(templateName, lastError)
  }

  // The same test a template URL on the command line gets. An override that
  // answers with a page used to reach the unzip and fail there untyped.
  if (!isZipBuffer(buffer)) {
    throw new TemplateNotZipError(
      source,
      describeNonZipResponse(contentType, buffer)
    )
  }

  await extractExamplesTemplateFromZip(
    buffer,
    templateName,
    projectPath,
    source
  )

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

// Copy a template that already sits on this machine into projectPath. Shared by
// the bundled path, the offline fallback and a `--template <directory>`, so the
// three cannot drift on what a copied template brings with it.
async function copyTemplateDirectory(
  sourceDir: string,
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void},
  ownerGitignore: string | null
): Promise<void> {
  await utils.copyDirectoryWithSymlinks(sourceDir, projectPath)
  await restoreOwnerGitignore(projectPath, ownerGitignore)
  await removeTemplateScaffoldingFiles(projectPath)
  const dropped = await removeStaleTemplateLockfiles(projectPath)

  if (dropped.length) {
    logger.log(messages.removedStaleTemplateLockfiles(dropped))
  }
}

// Returns the bundled template's provenance, or undefined when the template is
// not actually bundled on disk.
async function copyBundledTemplate(
  templateName: string,
  projectPath: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void},
  ownerGitignore: string | null = null
): Promise<TemplateProvenance | undefined> {
  const localTemplate = bundledTemplateDir(templateName)
  if (!existsSync(localTemplate)) return undefined

  await copyTemplateDirectory(
    localTemplate,
    projectPath,
    logger,
    ownerGitignore
  )

  return {template: templateName, source: 'bundled'}
}

// A bare word is a catalog name, never a lookup against the working directory:
// a folder that happens to be called `react` must not silently replace the
// catalog's react. Only a value written as a path is read as one.
function looksLikeTemplatePath(template: string): boolean {
  return (
    path.isAbsolute(template) ||
    /^[.~]/.test(template) ||
    template.includes('/') ||
    template.includes(path.sep)
  )
}

// The directory a path-shaped `--template` names, when it exists. A path used
// to be reduced to its basename and looked up in the catalog, so asking for
// `./my-template` scaffolded the REMOTE entry of the same name and said it
// succeeded. A path that does not exist still falls through to the catalog,
// which is how `examples/newtab-react` resolves.
function resolveLocalTemplateDir(template: string): string | undefined {
  if (!looksLikeTemplatePath(template)) return undefined

  const expanded = template.startsWith('~/')
    ? path.join(os.homedir(), template.slice(2))
    : template
  const resolved = path.resolve(expanded)

  try {
    return statSync(resolved).isDirectory() ? resolved : undefined
  } catch {
    return undefined
  }
}

// The real path of the nearest ancestor that exists, with the rest appended:
// an output directory is usually not made yet when it is compared.
function realPathOrResolved(target: string): string {
  const resolved = path.resolve(target)
  const missing: string[] = []
  let current = resolved

  while (true) {
    try {
      return path.join(realpathSync(current), ...missing)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return resolved

      missing.unshift(path.basename(current))
      current = parent
    }
  }
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
      : `${ownerContents.replace(/\n?$/, '\n')}\n# Extension.js template rules\n${added.join('\n')}\n`
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

  // A directory on this machine is the template itself, so it is read before
  // any catalog lookup can claim its name.
  const localTemplateDir = isHttp
    ? undefined
    : resolveLocalTemplateDir(template)

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
  // The staging folder an archive unpacks into, removed on every way out.
  let tempRoot: string | undefined

  try {
    if (isRefusedHttpTemplateUrl(template)) {
      throw new InsecureTemplateUrlError(template)
    }

    if (localTemplateDir) {
      // Compared resolved, so a symlinked spelling of either path cannot hide
      // that one sits inside the other.
      const outsideTemplate = path.relative(
        realPathOrResolved(localTemplateDir),
        realPathOrResolved(projectPath)
      )

      // An output path inside the template would copy the directory into
      // itself, which recurses instead of refusing.
      if (
        !outsideTemplate ||
        (!outsideTemplate.startsWith('..') && !path.isAbsolute(outsideTemplate))
      ) {
        throw new Error(
          messages.templateDirectoryIsDestination(
            localTemplateDir,
            path.resolve(projectPath)
          )
        )
      }
    }

    await fs.mkdir(projectPath, {recursive: true})

    if (localTemplateDir) {
      await copyTemplateDirectory(
        localTemplateDir,
        projectPath,
        logger,
        ownerGitignore
      )

      // The name alone: the path holds a home folder, and the record this
      // feeds is a file the project commits.
      return {template: path.basename(localTemplateDir), source: 'local'}
    }

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

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'extension-js-create-'))
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

    const fetchZipArchive = async () => {
      const {data, headers} = await axios.get(template, {
        responseType: 'arraybuffer',
        maxRedirects: 5,
        timeout: NETWORK_TIMEOUT_MS,
        beforeRedirect: refuseHttpRedirect
      })
      const contentType = String(headers?.['content-type'] || '')
      const body = Buffer.from(data)
      const looksZip =
        /zip|octet-stream/i.test(contentType) ||
        template.toLowerCase().endsWith('.zip')

      // The name and the header are claims. The first bytes are the answer,
      // and a login page or an empty reply fails here, not in the unzip.
      if (!looksZip || !isZipBuffer(body)) {
        throw new TemplateNotZipError(
          template,
          describeNonZipResponse(contentType, body)
        )
      }

      return body
    }

    let provenance: TemplateProvenance

    if (isGithub) {
      // A URL that cannot be fetched is a DOWNLOAD failure, same as a catalog
      // ref that cannot be fetched. Left untyped it reached the frameless sink,
      // which printed the spawned git's stack into node_modules and coded the
      // refusal E_INTERNAL for a url the user mistyped.
      try {
        await runGoGitIt(template, tempPath)
      } catch (fetchError) {
        throw new TemplateDownloadError(template, fetchError)
      }

      const candidates = await fs.readdir(tempPath, {withFileTypes: true})
      const preferred = candidates.find(
        (d) => d.isDirectory() && d.name === templateName
      )
      const srcPath = preferred ? path.join(tempPath, templateName) : tempPath
      await utils.moveDirectoryContents(srcPath, projectPath)
      provenance = {template: resolvedTemplateName, source: template}
    } else if (isHttp) {
      // Typed for the same reason as the GitHub branch above: a ZIP URL that
      // answers with a 404 or an HTML page is the user's URL to fix, not a
      // fault to report with our stack. axios times out an idle socket and
      // not a reply that trickles in, so the whole fetch gets one budget.
      const budget = startFetchBudget(NETWORK_TIMEOUT_MS)
      const data = await withTimeout(fetchZipArchive(), budget.ms, () =>
        fetchBudgetSpent(budget)
      ).catch((fetchError: unknown) => {
        // A downgrade refusal and a reply that is not an archive are their
        // own frames and must keep their own types.
        throw (
          findInsecureTemplateUrlError(fetchError) ??
          (fetchError instanceof TemplateNotZipError
            ? fetchError
            : new TemplateDownloadError(
                template,
                budgetSpentBy(fetchError, budget)
                  ? fetchBudgetSpent(budget)
                  : fetchError
              ))
        )
      })

      await extractZipBufferTo(data, tempPath, template)
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

    return provenance
  } catch (error) {
    // A catalog override is a URL someone set on purpose, often to keep a run
    // offline, so a failed one is reported and never swapped for the bundled one.
    const catalogOverride =
      !isHttp && !isGithub
        ? process.env.EXTENSION_CREATE_TEMPLATE_URL || undefined
        : undefined

    // The default template downloads, so an offline machine cannot fetch it. A
    // download failure on the default falls back to the bundled template rather
    // than failing the whole create, and the swap is named below so it is never
    // silent. A missing slug (TemplateNotFoundError) is a typo, not a network
    // outage, and must not be answered with a different template.
    if (
      error instanceof TemplateDownloadError &&
      options?.allowOfflineFallback &&
      !catalogOverride &&
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
    const insecureUrl = findInsecureTemplateUrlError(error)
    const frame = insecureUrl
      ? messages.templateUrlNotHttps(insecureUrl.url)
      : error instanceof TemplateNotFoundError
        ? // A path-shaped request was resolved through the catalog by its
          // basename, so naming the basename alone dropped the path the user
          // typed out of the refusal.
          looksLikeTemplatePath(template)
          ? messages.templatePathNotFound(template)
          : messages.templateNotFoundInCatalog(
              templateName,
              (error as {cause?: unknown}).cause
            )
        : error instanceof TemplateNotZipError
          ? messages.templateUrlNotZip(error.url, error.got, catalogOverride)
          : error instanceof TemplateArchiveEntryOutsideError
            ? messages.templateArchiveEntryOutside(
                error.url,
                error.entry,
                catalogOverride
              )
            : error instanceof TemplateArchiveDamagedError
              ? messages.templateArchiveDamaged(
                  error.url,
                  error.reason,
                  catalogOverride
                )
              : error instanceof TemplateDownloadError
                ? isHttp
                  ? messages.templateUrlFetchFailed(template, error)
                  : catalogOverride
                    ? messages.templateOverrideFetchFailed(
                        catalogOverride,
                        error
                      )
                    : messages.templateDownloadFailed(templateName, error)
                : null

    // A step that framed its own refusal (an output path inside the template)
    // already carries the one frame the CLI prints.
    if (
      frame === null &&
      !hasChannelPrefix(String((error as Error)?.message))
    ) {
      logger.error(messages.installingFromTemplateError(templateName, error))
    }

    // Clean the partial scaffold so a retry into the same name is not
    // poisoned, without ever touching content that pre-existed this run.
    await cleanupFailedImport(projectPath, ownsProjectDir, preExistingEntries)

    // The CLI prints a framed message as-is and a bare one with its stack,
    // so the frame travels on the error and is never logged here as well.
    if (frame !== null && error instanceof Error) error.message = frame

    throw error
  } finally {
    if (tempRoot) {
      await fs.rm(tempRoot, {recursive: true, force: true}).catch(() => {})
    }
  }
}

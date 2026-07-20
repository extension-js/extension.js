//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs/promises'
import {existsSync} from 'fs'
import * as os from 'os'
import axios from 'axios'
import AdmZip from 'adm-zip'
import goGitIt from 'go-git-it'
import * as messages from '../lib/messages'
import * as utils from '../lib/utils'

const NETWORK_TIMEOUT_MS = (() => {
  const raw = parseInt(
    String(process.env.EXTENSION_CREATE_TIMEOUT_MS || ''),
    10
  )
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000
})()

// The extension-js/examples branch built-in templates are sourced from. Override
// for testing a template PR before it merges.
const EXAMPLES_REF = process.env.EXTENSION_CREATE_TEMPLATE_REF || 'main'

// Distinguish a genuinely-absent catalog slug from a download/timeout/rate-limit
// failure. The old path (go-git-it) surfaced BOTH as "choose a valid template
// name", which is the core of #56 — a slow network read reported as a bad slug.
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
    const msg =
      (cause as {message?: string})?.message ?? String(cause)
    super(msg)
    this.name = 'TemplateDownloadError'
    this.templateName = templateName
    ;(this as {cause?: unknown}).cause = cause
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Fetch a repo tarball over plain HTTP (codeload), NOT a git pack negotiation:
// no git child, so no credential-helper hang, and one gzipped stream instead of
// a full clone. One automatic retry with backoff. (#56 acceptance 1 & 3.)
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
      if (attempt < attempts) await sleep(400 * attempt)
    }
  }
  throw lastError
}

// Extract ONLY `<archive-root>/examples/<templateName>/**` from a GitHub zip
// archive into projectPath. Exported for tests (no network). Throws
// TemplateNotFoundError when the slug isn't present in the archive.
export async function extractExamplesTemplateFromZip(
  zipBuffer: Buffer,
  templateName: string,
  projectPath: string
): Promise<number> {
  const zip = new AdmZip(zipBuffer)
  const entries = zip.getEntries()
  if (!entries.length) {
    throw new TemplateNotFoundError(templateName, new Error('empty archive'))
  }
  // GitHub archives wrap everything in a single top dir (e.g. `examples-main/`).
  const archiveRoot = entries[0].entryName.split('/')[0]
  const wanted = `${archiveRoot}/examples/${templateName}/`
  const files = entries.filter(
    (e) => !e.isDirectory && e.entryName.startsWith(wanted)
  )
  if (!files.length) throw new TemplateNotFoundError(templateName)

  let written = 0
  for (const entry of files) {
    const rel = entry.entryName.slice(wanted.length)
    if (!rel) continue
    const dest = path.join(projectPath, rel)
    await fs.mkdir(path.dirname(dest), {recursive: true})
    await fs.writeFile(dest, entry.getData())
    written++
  }
  return written
}

// The #56 built-in-template path: pull the examples repo tarball over HTTP and
// unpack just the one requested template. Replaces the go-git-it full-clone for
// every catalog slug, so the ~51 remote templates scaffold without git.
async function importFromExamplesCatalog(
  templateName: string,
  projectPath: string
): Promise<void> {
  const url = `https://codeload.github.com/extension-js/examples/zip/refs/heads/${EXAMPLES_REF}`
  let buffer: Buffer
  try {
    buffer = await downloadArchive(url, NETWORK_TIMEOUT_MS)
  } catch (error) {
    throw new TemplateDownloadError(templateName, error)
  }
  await extractExamplesTemplateFromZip(buffer, templateName, projectPath)
}

function isAuthorOrDevMode(): boolean {
  return (
    process.env.EXTENSION_ENV === 'development' ||
    process.env.EXTENSION_AUTHOR_MODE === 'true'
  )
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
  // Keep the underlying tool's output in dev/author mode — silencing it there
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

// Files the extension-js/examples repo carries for its own gallery + E2E
// tooling. They have no purpose in a scaffolded user project — `template.meta.json`
// is the gallery "featured" flag, `template.spec.ts` is the examples E2E spec
// (and trips `tsc --noEmit` in a fresh project), and the root `screenshot.png`
// is the gallery thumbnail (the generated README embeds `public/screenshot.png`,
// not this one). Strip them after copying any template. See issue #476.
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

export async function importExternalTemplate(
  projectPath: string,
  projectName: string,
  template: string,
  logger: {log(...args: any[]): void; error(...args: any[]): void}
) {
  const templateName = path.basename(template)
  // Default template is `javascript`. `init` remains an alias for the same examples folder.
  const resolvedTemplate = templateName === 'init' ? 'javascript' : template
  const resolvedTemplateName =
    templateName === 'init' ? 'javascript' : templateName

  const isHttp = /^https?:\/\//i.test(template)
  const isGithub = /^https?:\/\/github\.com\//i.test(template)

  try {
    // Ensure the project path exists
    await fs.mkdir(projectPath, {recursive: true})

    if (!isHttp && !isGithub && resolvedTemplate === 'javascript') {
      const localTemplate = bundledTemplateDir('javascript')

      if (existsSync(localTemplate)) {
        await utils.copyDirectoryWithSymlinks(localTemplate, projectPath)
        await removeTemplateScaffoldingFiles(projectPath)
        return
      }
      // Bundled copy missing (unexpected): fall through to the network fetch
    }

    // Create a temporary directory for fetching remote templates
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'extension-js-create-')
    )
    const tempPath = path.join(tempRoot, projectName + '-temp')
    await fs.mkdir(tempPath, {recursive: true})

    const runGoGitIt = async (templatePath: string, destination: string) => {
      // Harden the spawned git so a credential-helper prompt can't hang it
      // (#56: one of the three stacked triggers — `GIT_TERMINAL_PROMPT=0`
      // unblocked the pull). go-git-it's execFile inherits process.env.
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

    if (isGithub) {
      await runGoGitIt(template, tempPath)
      // If a subfolder exists matching the last path segment, use it; otherwise copy from tempPath
      const candidates = await fs.readdir(tempPath, {withFileTypes: true})
      const preferred = candidates.find(
        (d) => d.isDirectory() && d.name === templateName
      )
      const srcPath = preferred ? path.join(tempPath, templateName) : tempPath
      await utils.moveDirectoryContents(srcPath, projectPath)
    } else if (isHttp) {
      // Download zip and extract
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
      const zip = new AdmZip(Buffer.from(data))
      zip.extractAllTo(tempPath, true)
      const sourcePath = await getZipSourcePath(tempPath, template)
      await utils.moveDirectoryContents(sourcePath, projectPath)
    } else {
      // Built-in template names resolve to a single template folder in the
      // extension-js/examples catalog, fetched as an HTTP tarball (#56) — no git
      // pack negotiation, no credential-helper hang, and only the one template
      // is unpacked instead of the whole monorepo.
      await importFromExamplesCatalog(resolvedTemplateName, projectPath)
    }

    // Strip examples-repo scaffolding that should never ship in a user project.
    await removeTemplateScaffoldingFiles(projectPath)

    // Cleanup temp
    await fs.rm(tempRoot, {recursive: true, force: true})
  } catch (error: any) {
    // Distinguish a genuinely-missing slug from a download/timeout/rate-limit
    // failure — the old path reported every failure as "choose a valid template
    // name", which is the #56 mislabel.
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
      logger.error(
        messages.installingFromTemplateError(projectName, templateName, error)
      )
    }
    // Clean the partial target dir so a retry into the same name is not poisoned.
    await fs.rm(projectPath, {recursive: true, force: true}).catch(() => {})
    throw error
  }
}

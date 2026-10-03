// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {unzipSync} from 'fflate'
import {humanLine} from '../dev-server/lifecycle-stream'
import {type CodedError, codedError} from './coded-error'
import * as messages from './messages'
import {CODES, type ErrorCode} from './messaging'

function isZipBuffer(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false

  const third = buffer[2]
  const fourth = buffer[3]

  return (
    (third === 0x03 && fourth === 0x04) ||
    (third === 0x05 && fourth === 0x06) ||
    (third === 0x07 && fourth === 0x08)
  )
}

type ZipEntries = Record<string, Uint8Array>

// Read apart from the write, so a body that will not unpack is told from a
// destination that cannot be written, and gets the caller's own refusal.
function readEntries(
  zipBuffer: Buffer,
  unreadable: (cause: unknown) => CodedError
): ZipEntries {
  try {
    return unzipSync(new Uint8Array(zipBuffer))
  } catch (cause) {
    throw unreadable(cause)
  }
}

// A zip-slip guard: entries naming absolute paths or escaping the destination
// throw, and symlink entries are never materialized as symlinks.
function writeEntries(entries: ZipEntries, root: string): void {
  fs.mkdirSync(root, {recursive: true})

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
      fs.mkdirSync(target, {recursive: true})
      continue
    }

    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, data)
  }
}

// An extraction replaces the destination instead of merging into it, so a
// file the archive dropped stops shipping and a failed extract leaves nothing.
function extractBuffer(entries: ZipEntries, destinationPath: string): void {
  humanLine(messages.unpackagingExtension(destinationPath))

  const root = path.resolve(destinationPath)
  const staging = `${root}.extension-staging-${process.pid.toString(36)}-${Date.now().toString(36)}`

  try {
    writeEntries(entries, staging)
  } catch (error) {
    fs.rmSync(staging, {recursive: true, force: true})

    throw error
  }

  try {
    fs.rmSync(root, {recursive: true, force: true})
    fs.mkdirSync(path.dirname(root), {recursive: true})

    try {
      fs.renameSync(staging, root)
    } catch {
      // The staging directory is a sibling, so a rename only fails on a file
      // system that refuses it outright. Copy, then drop the staged tree.
      fs.cpSync(staging, root, {recursive: true})
      fs.rmSync(staging, {recursive: true, force: true})
    }
  } catch (error) {
    fs.rmSync(staging, {recursive: true, force: true})

    throw error
  }

  humanLine(messages.unpackagedSuccessfully())
}

// The message IS the printable block and the CLI prints the message of the
// error it catches. Printing here as well is what showed every failure twice.
function asZipError(error: unknown, code: ErrorCode): CodedError {
  const known = Object.values(CODES) as string[]

  // A refusal raised with its own code is already the block to print.
  if (error instanceof Error && known.includes((error as CodedError).code)) {
    return error as CodedError
  }

  return codedError(code, messages.failedToDownloadOrExtractZIPFileError(error))
}

// Marks a tree as fetched by this tool from one source, which is what tells
// it apart from a stranger's folder that happens to carry the same name.
export const REMOTE_SOURCE_PROVENANCE_FILE = '.extension-source.json'

// One url is one source however many slashes trail it.
export function sourceKey(source: string): string {
  let end = source.length

  while (end > 0 && source[end - 1] === '/') end--

  return source.slice(0, end)
}

export function readRemoteSource(directory: string): string | undefined {
  try {
    const raw = fs.readFileSync(
      path.join(directory, REMOTE_SOURCE_PROVENANCE_FILE),
      'utf-8'
    )
    const parsed = JSON.parse(raw) as {source?: unknown} | null
    const source = parsed?.source

    return typeof source === 'string' ? sourceKey(source) : undefined
  } catch {
    return undefined
  }
}

export function writeRemoteSource(directory: string, source: string): void {
  const record = {
    source: sourceKey(source),
    fetchedAt: new Date().toISOString()
  }

  try {
    fs.writeFileSync(
      path.join(directory, REMOTE_SOURCE_PROVENANCE_FILE),
      `${JSON.stringify(record, null, 2)}\n`
    )
  } catch {
    // Advisory: a tree we could not stamp is still the tree this run fetched.
    // The next run just has to fetch again instead of recognizing it.
  }
}

// Where a remote archive url lands under targetPath. Exported so a caller can
// vet the destination before anything is downloaded into it.
export function remoteZipDestination(url: string, targetPath: string): string {
  const urlNoSearchParams = url.split('?')[0]
  const extname = path.extname(urlNoSearchParams)

  return path.join(targetPath, path.basename(urlNoSearchParams, extname))
}

// A destination this tool did not record as coming from this source is not
// ours to adopt or write over. Its name says nothing about what it holds.
export function assertDestinationIsOurs(
  destinationPath: string,
  source: string
): void {
  if (!fs.existsSync(destinationPath)) return

  let entries: string[] = []

  try {
    entries = fs.readdirSync(destinationPath)
  } catch {
    // Unreadable: leave it alone rather than guess what it holds.
    throw codedError(
      CODES.E_DESTINATION_NOT_EMPTY,
      messages.remoteSourceDestinationTaken(destinationPath, source)
    )
  }

  // An empty folder is what a previous interrupted run leaves behind.
  if (entries.length === 0) return
  if (readRemoteSource(destinationPath) === sourceKey(source)) return

  throw codedError(
    CODES.E_DESTINATION_NOT_EMPTY,
    messages.remoteSourceDestinationTaken(destinationPath, source)
  )
}

export async function downloadAndExtractZip(
  url: string,
  targetPath: string
): Promise<string> {
  const urlNoSearchParams = url.split('?')[0]

  try {
    assertDestinationIsOurs(remoteZipDestination(url, targetPath), url)

    humanLine(messages.downloadingText(urlNoSearchParams))

    const res = await fetch(url, {redirect: 'follow'})

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    const contentType = String(res.headers.get('content-type') || '')
    const isZipExt = path.extname(urlNoSearchParams).toLowerCase() === '.zip'
    const isZipType = /zip|octet-stream/i.test(contentType)

    // The server answered, with something that is not an archive. That is
    // the URL to fix, so it keeps its own block and never the download one.
    if (!isZipExt && !isZipType) {
      throw codedError(
        CODES.E_REMOTE_ZIP_INVALID,
        messages.invalidRemoteZip(urlNoSearchParams, contentType)
      )
    }

    const destinationPath = remoteZipDestination(url, targetPath)

    const arrayBuffer = await res.arrayBuffer()
    const zipBuffer = Buffer.from(arrayBuffer)

    if (!isZipBuffer(zipBuffer)) {
      throw codedError(
        CODES.E_REMOTE_ZIP_INVALID,
        messages.notAZipArchive(urlNoSearchParams, contentType)
      )
    }

    const entries = readEntries(zipBuffer, (cause) =>
      codedError(
        CODES.E_REMOTE_ZIP_INVALID,
        messages.remoteZipDamaged(urlNoSearchParams, cause)
      )
    )

    extractBuffer(entries, destinationPath)
    writeRemoteSource(destinationPath, url)

    return destinationPath
  } catch (error) {
    throw asZipError(error, CODES.E_REMOTE_DOWNLOAD)
  }
}

export async function extractLocalZip(
  zipFilePath: string,
  targetPath: string
): Promise<string> {
  try {
    if (!fs.existsSync(zipFilePath) || !fs.statSync(zipFilePath).isFile()) {
      throw codedError(
        CODES.E_LOCAL_ZIP_NOT_FOUND,
        messages.localZipNotFound(zipFilePath)
      )
    }

    const extname = path.extname(zipFilePath)
    const basename = path.basename(zipFilePath, extname)
    const destinationPath = path.join(targetPath, basename)
    const source = path.resolve(zipFilePath)

    // The extraction replaces the destination, so a folder that merely
    // shares the archive's name is refused exactly like a remote one.
    assertDestinationIsOurs(destinationPath, source)

    const zipBuffer = fs.readFileSync(zipFilePath)

    if (!isZipBuffer(zipBuffer)) {
      throw codedError(
        CODES.E_LOCAL_ZIP_NOT_FOUND,
        messages.localZipUnreadable(zipFilePath)
      )
    }

    const entries = readEntries(zipBuffer, (cause) =>
      codedError(
        CODES.E_LOCAL_ZIP_NOT_FOUND,
        messages.localZipUnreadable(zipFilePath, cause)
      )
    )

    extractBuffer(entries, destinationPath)
    writeRemoteSource(destinationPath, source)

    return destinationPath
  } catch (error) {
    throw asZipError(error, CODES.E_LOCAL_ZIP_NOT_FOUND)
  }
}

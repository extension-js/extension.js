// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import AdmZip from 'adm-zip'
import * as messages from './messages'

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

function extractBuffer(zipBuffer: Buffer, destinationPath: string): void {
  console.log(messages.unpackagingExtension(destinationPath))

  const zip = new AdmZip(zipBuffer)
  zip.extractAllTo(destinationPath, true)

  console.log(messages.unpackagedSuccessfully())
}

function asZipError(error: unknown): Error {
  console.error(messages.failedToDownloadOrExtractZIPFileError(error))

  // Ensure non-zip error yields a non-zero exit code when invoked via CLI
  // by propagating an error instance with a clear message
  const err = new Error(
    `${messages.failedToDownloadOrExtractZIPFileError(error)}`
  )

  // @ts-expect-error - Error type does not have a code property
  err.code = 'EZIP'
  return err
}

export async function downloadAndExtractZip(
  url: string,
  targetPath: string
): Promise<string> {
  const urlNoSearchParams = url.split('?')[0]
  try {
    console.log(messages.downloadingText(urlNoSearchParams))

    // Step 1: Download the ZIP file
    const res = await fetch(url, {redirect: 'follow'})

    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    // Basic validation: ensure the URL or content-type looks like a ZIP
    const contentType = String(res.headers.get('content-type') || '')
    const isZipExt = path.extname(urlNoSearchParams).toLowerCase() === '.zip'
    const isZipType = /zip|octet-stream/i.test(contentType)

    if (!isZipExt && !isZipType) {
      throw new Error(
        `${messages.invalidRemoteZip(urlNoSearchParams, contentType)}`
      )
    }

    const extname = path.extname(urlNoSearchParams)
    const basename = path.basename(urlNoSearchParams, extname)
    const destinationPath = path.join(targetPath, basename)

    // Accumulate into a buffer
    const arrayBuffer = await res.arrayBuffer()
    const zipBuffer = Buffer.from(arrayBuffer)

    if (!isZipBuffer(zipBuffer)) {
      throw new Error(
        `${messages.notAZipArchive(urlNoSearchParams, contentType)}`
      )
    }

    // Step 2: Extract the ZIP file from the buffer
    extractBuffer(zipBuffer, destinationPath)

    return destinationPath
  } catch (error) {
    throw asZipError(error)
  }
}

export async function extractLocalZip(
  zipFilePath: string,
  targetPath: string
): Promise<string> {
  try {
    if (!fs.existsSync(zipFilePath) || !fs.statSync(zipFilePath).isFile()) {
      throw new Error(`${messages.localZipNotFound(zipFilePath)}`)
    }

    const extname = path.extname(zipFilePath)
    const basename = path.basename(zipFilePath, extname)
    const destinationPath = path.join(targetPath, basename)

    const zipBuffer = fs.readFileSync(zipFilePath)

    if (!isZipBuffer(zipBuffer)) {
      throw new Error(`${messages.notAZipArchive(zipFilePath)}`)
    }

    extractBuffer(zipBuffer, destinationPath)

    return destinationPath
  } catch (error) {
    throw asZipError(error)
  }
}

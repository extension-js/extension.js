// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import AdmZip from 'adm-zip'
import * as messages from './messages'

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

    console.log(messages.unpackagingExtension(destinationPath))

    // Accumulate into a buffer
    const arrayBuffer = await res.arrayBuffer()
    const zipBuffer = Buffer.from(arrayBuffer)

    // Step 2: Extract the ZIP file from the buffer
    const zip = new AdmZip(zipBuffer)

    zip.extractAllTo(destinationPath, true)
    console.log(messages.unpackagedSuccessfully())

    return destinationPath
  } catch (error: any) {
    console.error(messages.failedToDownloadOrExtractZIPFileError(error))
    // Ensure non-zip error yields a non-zero exit code when invoked via CLI
    // by propagating an error instance with a clear message
    const err = new Error(
      `${messages.failedToDownloadOrExtractZIPFileError(error)}`
    )
    // @ts-expect-error - Error type does not have a code property
    err.code = 'EZIP'
    throw err
  }
}

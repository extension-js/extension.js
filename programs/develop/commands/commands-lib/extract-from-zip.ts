import path from 'path'
import axios from 'axios'
import stream from 'stream'
import AdmZip from 'adm-zip'
import * as messages from './messages'
import {promisify} from 'util'

const pipeline = promisify(stream.pipeline)

export async function downloadAndExtractZip(
  url: string,
  targetPath: string
): Promise<string> {
  const urlNoSearchParams = url.split('?')[0]
  try {
    console.log(messages.downloadingText(urlNoSearchParams))

    // Step 1: Download the ZIP file and pipe it directly to the extraction process
    const response = await axios.get(url, {
      // Stream the response data
      responseType: 'stream'
    })

    const extname = path.extname(urlNoSearchParams)
    const basename = path.basename(urlNoSearchParams, extname)
    const destinationPath = path.join(targetPath, basename)

    console.log(messages.unpackagingExtension(destinationPath))

    const zipChunks: Uint8Array[] = []

    // Accumulate chunks to form the ZIP buffer
    await pipeline(
      response.data,
      new stream.Writable({
        write(chunk, _encoding, callback) {
          zipChunks.push(chunk)
          callback()
        }
      })
    )

    const zipBuffer = Buffer.concat(zipChunks)

    // Step 2: Extract the ZIP file from the buffer
    const zip = new AdmZip(zipBuffer)

    zip.extractAllTo(destinationPath, true)
    console.log(messages.unpackagedSuccessfully())

    return destinationPath
  } catch (error: any) {
    console.error(messages.failedToDownloadOrExtractZIPFileError(error))
    throw error
  }
}

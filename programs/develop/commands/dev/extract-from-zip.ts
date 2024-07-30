import fs from 'fs/promises'
import path from 'path'
import axios from 'axios'
import AdmZip from 'adm-zip'
import * as messages from '../../webpack/lib/messages'

export async function downloadAndExtractZip(
  url: string,
  targetPath: string
): Promise<void> {
  const urlNoSearchParams = url.split('?')[0]
  try {
    console.log(messages.downloadingText(urlNoSearchParams))

    // Step 1: Download the ZIP file
    const response = await axios({
      url,
      method: 'GET',
      // Important: it tells axios to handle the response as binary data
      responseType: 'arraybuffer'
    })

    const filename = path.basename(urlNoSearchParams)
    const zipFilePath = path.join(targetPath, `${filename}.zip`)
    await fs.writeFile(zipFilePath, response.data as string)

    console.log(messages.unpackagingExtension(zipFilePath))

    // Step 2: Extract the ZIP file
    const zip = new AdmZip(zipFilePath)
    zip.extractAllTo(targetPath, true)

    // Step 3: Cleanup
    await fs.unlink(zipFilePath)

    console.log(messages.unpackagedSuccessfully())
  } catch (error) {
    // console.error(error)
    throw error
  }
}

import fs from 'fs/promises'
import path from 'path'
import {green, white, bold, underline} from '@colors/colors/safe'
import axios from 'axios'
import AdmZip from 'adm-zip'

export default async function downloadAndExtractZip(
  url: string,
  targetPath: string
): Promise<void> {
  const urlNoSearchParams = url.split('?')[0]
  try {
    const downloadingText = `🧩 ${bold(`Extension`)} ${green(
      `►►►`
    )} Downloading extension from ${bold(urlNoSearchParams)}...`

    console.log(downloadingText)

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

    console.log(
      `🧩 ${bold(`Extension`)} ${green(
        `►►►`
      )} Unpackaging browser extension from ${white(underline(zipFilePath))}`
    )

    // Step 2: Extract the ZIP file
    const zip = new AdmZip(zipFilePath)
    zip.extractAllTo(targetPath, true)

    // Step 3: Cleanup
    await fs.unlink(zipFilePath)

    console.log(
      `🧩 ${bold(`Extension`)} ${green(
        `►►►`
      )} Browser extension unpackaged successfully. Compiling...`
    )
  } catch (error) {
    console.error(`Failed to download or extract ZIP file: ${error}`)
    throw error
  }
}

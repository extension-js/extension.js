import fs from 'fs'
import path from 'path'
import {green, white, bold, underline} from '@colors/colors/safe'
import axios from 'axios'
import AdmZip from 'adm-zip'

export default async function downloadAndExtractZip(
  url: string,
  targetPath: string
): Promise<void> {
  try {
    const downloadingText = `🧩 ${bold(`extension`)} ${green(
      `►►►`
    )} Downloading extension from ${bold(url)}...`

    console.log(downloadingText)

    // Step 1: Download the ZIP file
    const response = await axios({
      url,
      method: 'GET',
      // Important: it tells axios to handle the response as binary data
      responseType: 'arraybuffer'
    })

    const zipFilePath = path.join(targetPath, 'downloaded.zip')
    fs.writeFileSync(zipFilePath, response.data)

    console.log(
      `🧩 ${bold(`extension`)} ${green(
        `►►►`
      )} Creating a new browser extension from ${white(underline(zipFilePath))}`
    )

    // Step 2: Extract the ZIP file
    const zip = new AdmZip(zipFilePath)
    zip.extractAllTo(/*target path*/ targetPath, /*overwrite*/ true)

    // Step 3: Cleanup
    fs.unlinkSync(zipFilePath)
  } catch (error) {
    console.error(`Failed to download or extract ZIP file: ${error}`)
  }
}

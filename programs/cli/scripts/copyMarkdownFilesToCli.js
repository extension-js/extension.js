//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

import * as fs from 'fs/promises'
import * as path from 'path'
import {fileURLToPath} from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const sourceDir = path.resolve(__dirname, '../../../')
const targetDir = path.resolve(__dirname, '../')

async function copyMarkdownFilesToCli(sourcePath, targetPath) {
  try {
    const sourceData = await fs.readFile(sourcePath, 'utf8')
    let targetData = ''
    try {
      targetData = await fs.readFile(targetPath, 'utf8')
    } catch {
      // If target file doesn't exist, set targetData to an empty string
      targetData = ''
    }
    if (sourceData !== targetData) {
      await fs.writeFile(targetPath, sourceData, 'utf8')
      console.log(
        `[Extension.js setup] File ${path.basename(
          sourcePath
        )} copied to ${targetPath}`
      )
    } else {
      console.log(
        `[Extension.js setup] File ${path.basename(
          sourcePath
        )} haven't changed. Skipping copy...`
      )
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`File not found: ${err.path}`)
    } else {
      console.error(err)
    }
  }
}

;(async () => {
  try {
    await copyMarkdownFilesToCli(
      path.join(sourceDir, 'README.md'),
      path.join(targetDir, 'README.md')
    )
  } catch (error) {
    console.error(error)
  }
})()

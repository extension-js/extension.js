//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

/* eslint-disable @typescript-eslint/no-floating-promises */

const fs = require('fs/promises')
const path = require('path')

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
        `[extension-create setup] File ${path.basename(
          sourcePath
        )} copied to ${targetPath}`
      )
    } else {
      console.log(
        `[extension-create setup] File ${path.basename(
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
    await copyMarkdownFilesToCli(
      path.join(sourceDir, 'OPTIONS_TABLE.md'),
      path.join(targetDir, 'OPTIONS_TABLE.md')
    )
  } catch (error) {
    console.error(error)
  }
})()

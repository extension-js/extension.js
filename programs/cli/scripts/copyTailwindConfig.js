//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝

/* eslint-disable @typescript-eslint/no-floating-promises */

const fs = require('fs/promises')
const path = require('path')

const sourceDir = path.resolve(__dirname, '../../develop/integration-configs/')
const targetDir = path.resolve(__dirname, '../dist')

async function copyTailwindConfigFile(sourcePath, targetPath) {
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
    await copyTailwindConfigFile(
      path.join(sourceDir, 'tailwind.config.js'),
      path.join(targetDir, 'tailwind.config.js')
    )
  } catch (error) {
    console.error(error)
  }
})()

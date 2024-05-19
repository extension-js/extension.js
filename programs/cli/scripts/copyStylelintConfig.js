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

async function copyStylelintConfigFile(sourcePath, targetPath) {
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
    await copyStylelintConfigFile(
      path.join(sourceDir, 'stylelint.config.js'),
      path.join(targetDir, 'stylelint.config.js')
    )
  } catch (error) {
    console.error(error)
  }
})()

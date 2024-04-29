#!/usr/bin/env node

// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝

/* eslint-disable @typescript-eslint/no-floating-promises */

const path = require('path')
const fs = require('fs/promises')

const sourceDir = path.resolve(__dirname, '../')
const targetDir = path.resolve(__dirname, '../dist')

async function copyStylelintConfig(sourcePath, targetPath) {
  try {
    const sourceStats = await fs.stat(sourcePath)
    if (sourceStats.isDirectory()) {
      await fs.mkdir(targetPath, {recursive: true})
      console.log(`[Extension setup] Created folder: ${targetPath}`)
      const files = await fs.readdir(sourcePath)
      await Promise.all(
        files.map(async (file) => {
          const sourceFilePath = path.join(sourcePath, file)
          const targetFilePath = path.join(targetPath, file)
          await copyStylelintConfig(sourceFilePath, targetFilePath)
        })
      )
    } else {
      const sourceData = await fs.readFile(sourcePath, 'utf8')
      await fs.writeFile(targetPath, sourceData, 'utf8')
      console.log(
        `[Extension setup] File ${path.basename(
          sourcePath
        )} copied to ${targetPath}`
      )
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`File or directory not found: ${err.path.toString()}`)
    } else {
      console.error(err)
    }
  }
}

;(async () => {
  try {
    await copyStylelintConfig(
      path.join(sourceDir, 'integration-configs', 'stylelint.config.js'),
      path.join(targetDir, 'stylelint.config.js')
    )
  } catch (error) {
    console.log(
      `🚨 Error while copying stylelint config: \n${
        JSON.stringify(error) || ''
      }`
    )
    process.exit(1)
  }
})()

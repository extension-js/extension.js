/* eslint-disable */
const fs = require('fs').promises
const path = require('path')

async function copyDirectory() {
  const sourceDir = path.resolve(__dirname, './extensions')
  const destinationDir = path.resolve(__dirname, './dist/extensions')

  try {
    try {
      await fs.access(sourceDir)
    } catch (error) {
      console.error(`Source directory '${sourceDir}' not found.`)
      return
    }

    // Create the destination directory if it doesn't exist
    try {
      await fs.mkdir(destinationDir, {recursive: true})
    } catch (err) {
      // Ignore the error if the directory already exists
      if (err.code !== 'EEXIST') throw err
    }

    // Copy the contents of the source directory to the destination directory
    await copyRecursive(sourceDir, destinationDir)

    console.log(`Copied '${sourceDir}' to '${destinationDir}'.`)
  } catch (err) {
    console.error('An error occurred:', err)
  }
}

async function copyRecursive(src, dest) {
  const entries = await fs.readdir(src, {withFileTypes: true})
  await fs.mkdir(dest, {recursive: true}).catch((err) => {
    // Handle errors other than "directory already exists"
    if (err.code !== 'EEXIST') throw err
  })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

copyDirectory().catch(console.error)

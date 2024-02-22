const fs = require('fs-extra')
const path = require('path')

function copyDirectory() {
  const sourceDir = path.resolve(__dirname, './extensions')
  const destinationDir = path.resolve(__dirname, './dist/extensions')
  // Check if the source directory exists
  if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory '${sourceDir}' not found.`)
    return
  }

  // Create the destination directory if it doesn't exist
  fs.ensureDirSync(destinationDir)

  // Copy the contents of the source directory to the destination directory
  fs.copySync(sourceDir, destinationDir, {overwrite: true})

  console.log(`Copied '${sourceDir}' to '${destinationDir}'.`)
}

copyDirectory()

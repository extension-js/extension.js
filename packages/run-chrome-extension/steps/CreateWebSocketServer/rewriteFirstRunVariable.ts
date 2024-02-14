import path from 'path'
import fs from 'fs'

export default function rewriteFirstRunVariable(isFirstRun: boolean) {
  const filePath = path.resolve(
    __dirname,
    './extensions/manager-extension/initialTab.js'
  )

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading file: ${err.message}`)
      return
    }
    const updatedData = data.replace(
      /__IS_FIRST_RUN__ = false/g,
      `__IS_FIRST_RUN__ = ${isFirstRun}`.toString()
    )

    fs.writeFile(filePath, updatedData, 'utf8', (err) => {
      if (err) {
        console.error(`Error writing to file: ${err.message}`)
      }
    })
  })
}

import path from 'path'
import fs from 'fs'
import isFirstRun from '../RunChromePlugin/chrome/isFirstRun'

export default function rewriteFirstRunVariable() {
  const firstRun = isFirstRun()
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
      `__IS_FIRST_RUN__ = ${firstRun}`.toString()
    )

    fs.writeFile(filePath, updatedData, 'utf8', (err) => {
      if (err) {
        console.error(`Error writing to file: ${err.message}`)
      }
    })
  })
}

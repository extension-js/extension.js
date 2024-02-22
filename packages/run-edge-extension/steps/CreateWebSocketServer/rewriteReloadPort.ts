import path from 'path'
import fs from 'fs'

export default function replacePortInFile(port: number) {
  const filePath = path.resolve(
    __dirname,
    './extensions/reload-extension/reloadService.js'
  )

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading file: ${err.message}`)
      return
    }
    const updatedData = data.replace(/__RELOAD_PORT__/g, port.toString())
    fs.writeFile(filePath, updatedData, 'utf8', (err) => {
      if (err) {
        console.error(`Error writing to file: ${err.message}`)
      }
    })
  })
}

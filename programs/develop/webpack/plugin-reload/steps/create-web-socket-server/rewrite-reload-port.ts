import path from 'path'
import fs from 'fs'

export function replaceDataInFile(
  port: number
) {
  const reloadServiceFilePath = path.resolve(
    __dirname,
    './extensions/manager-extension/setup-reload-service.js'
  )

  fs.readFile(reloadServiceFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading file: ${err.message}`)
      return
    }
    const updatedData = data.replace(/__RELOAD_PORT__/g, port.toString())
    fs.writeFile(reloadServiceFilePath, updatedData, 'utf8', (err) => {
      if (err) {
        console.error(`Error writing to file: ${err.message}`)
      }
    })
  })
}

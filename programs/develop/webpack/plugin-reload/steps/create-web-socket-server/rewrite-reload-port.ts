import path from 'path'
import fs from 'fs'

export function replaceDataInFile(port: number) {
  const chromiumReloadServiceFilePath = path.resolve(
    __dirname,
    './extensions/manager-extension/reload-service.js'
  )

  const firefoxReloadServiceFilePath = path.resolve(
    __dirname,
    './extensions/manager-extension-firefox/reload-service.js'
  )

  fs.readFile(chromiumReloadServiceFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading file: ${err.message}`)
      return
    }
    const updatedData = data.replace(/__RELOAD_PORT__/g, port.toString())
    fs.writeFile(chromiumReloadServiceFilePath, updatedData, 'utf8', (err) => {
      if (err) {
        console.error(`Error writing to file: ${err.message}`)
      }
    })
  })

  fs.readFile(firefoxReloadServiceFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error(`Error reading file: ${err.message}`)
      return
    }
    const updatedData = data.replace(/__RELOAD_PORT__/g, port.toString())
    fs.writeFile(firefoxReloadServiceFilePath, updatedData, 'utf8', (err) => {
      if (err) {
        console.error(`Error writing to file: ${err.message}`)
      }
    })
  })
}

import * as path from 'path'
import * as fs from 'fs'
import {DevOptions} from '../../../../commands/commands-lib/config-types'

export function replaceDataInFile(
  browser: DevOptions['browser'],
  port: number
) {
  const reloadServiceFilePath = path.resolve(
    __dirname,
    `./extensions/${browser}-manager-extension/reload-service.js`
  )

  try {
    const data = fs.readFileSync(reloadServiceFilePath, 'utf8')
    const updatedData = data.replace(/__RELOAD_PORT__/g, port.toString())
    if (updatedData !== data) {
      fs.writeFileSync(reloadServiceFilePath, updatedData, 'utf8')
    }
  } catch (err) {
    console.error(`Error processing file: ${(err as Error).message}`)
  }
}

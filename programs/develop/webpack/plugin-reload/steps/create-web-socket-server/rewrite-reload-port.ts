import * as path from 'path'
import * as fs from 'fs'
import {Compiler} from '@rspack/core'
import {DevOptions} from '../../../../commands/commands-lib/config-types'

export function replaceDataInFile(
  compiler: Compiler,
  browser: DevOptions['browser'],
  port: number
) {
  const reloadServiceFilePath = path.resolve(
    path.dirname(compiler.options.output.path!),
    `extension-js/extensions/${browser}-manager/reload-service.js`
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

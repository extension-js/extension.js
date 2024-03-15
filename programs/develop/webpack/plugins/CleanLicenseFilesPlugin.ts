import fs from 'fs'
import path from 'path'
import {type Compiler} from 'webpack'

export default class CleanLicenseFilesPlugin {
  apply(compiler: Compiler): void {
    compiler.hooks.done.tap('CleanLicenseFilesPlugin', () => {
      const outputPath = compiler.options.output.path || ''
      this.deleteLicenseFiles(outputPath)
    })
  }

  deleteLicenseFiles(directory: string) {
    const files = fs.readdirSync(directory, {withFileTypes: true})
    files.forEach((file) => {
      const absolutePath = path.join(directory, file.name)
      if (file.isDirectory()) {
        this.deleteLicenseFiles(absolutePath)
      } else if (file.name.endsWith('LICENSE.txt')) {
        if (process.env.EXTENSION_ENV === 'development') {
          console.log('[CleanLicenseFilesPlugin] Removed LICENSE.txt files.')
        }
        fs.unlinkSync(absolutePath)
      }
    })
  }
}

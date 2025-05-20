import * as fs from 'fs'
import * as path from 'path'
import {Compiler} from '@rspack/core'
import {type PluginInterface} from '../../reload-types'
import {DevOptions} from '../../../../module'

export class GenerateManagerExtension {
  private readonly browser: DevOptions['browser']
  private readonly EXTENSION_SOURCE_DIR = 'extensions'
  private readonly EXTENSION_OUTPUT_DIR = 'extension-js'
  private readonly EXTENSIONS_DIR = 'extensions'

  constructor(options: PluginInterface) {
    this.browser = options.browser || 'chrome'
  }

  private copyRecursively(
    sourcePath: string,
    targetPath: string,
    port: string
  ): void {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, {recursive: true})
    }

    const entries = fs.readdirSync(sourcePath, {withFileTypes: true})

    for (const entry of entries) {
      const srcPath = path.join(sourcePath, entry.name)
      const destPath = path.join(targetPath, entry.name)

      if (entry.isDirectory()) {
        this.copyRecursively(srcPath, destPath, port)
      } else {
        let content = fs.readFileSync(srcPath, 'utf8')

        // Replace reload port in reload-service.js
        if (entry.name === 'reload-service.js') {
          content = content.replace(/__RELOAD_PORT__/g, port)
        }

        fs.writeFileSync(destPath, content)
      }
    }
  }

  private copyExtensionFiles(compiler: Compiler): void {
    const extensionSourcePath = path.join(
      __dirname,
      this.EXTENSION_SOURCE_DIR,
      `${this.browser}-manager-extension`
    )

    if (!fs.existsSync(extensionSourcePath)) {
      throw new Error(
        `Extension source folder not found at: ${extensionSourcePath}`
      )
    }

    const port = compiler.options.devServer?.port?.toString() || '8080'
    const distPath = path.dirname(compiler.options.output.path!)
    const targetPath = path.join(
      distPath,
      this.EXTENSION_OUTPUT_DIR,
      this.EXTENSIONS_DIR,
      `${this.browser}-manager`
    )

    this.copyRecursively(extensionSourcePath, targetPath, port)
  }

  apply(compiler: Compiler): void {
    const distPath = path.dirname(compiler.options.output.path!)
    const targetPath = path.join(
      distPath,
      this.EXTENSION_OUTPUT_DIR,
      this.EXTENSIONS_DIR,
      `${this.browser}-manager`,
      'reload-service.js'
    )

    if (!fs.existsSync(targetPath)) {
      this.copyExtensionFiles(compiler)
    }
  }
}

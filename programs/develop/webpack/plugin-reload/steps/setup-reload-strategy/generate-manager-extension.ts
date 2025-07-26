import * as fs from 'fs'
import * as path from 'path'
import {Compiler} from '@rspack/core'
import * as messages from '../../../lib/messages'
import {type PluginInterface} from '../../reload-types'
import {DevOptions} from '../../../../module'

export class GenerateManagerExtension {
  private readonly browser: DevOptions['browser']
  private readonly EXTENSION_SOURCE_DIR = 'extensions'
  private readonly EXTENSION_OUTPUT_DIR = 'extension-js'
  private readonly EXTENSIONS_DIR = 'extensions'
  private readonly port: number

  constructor(options: PluginInterface) {
    this.browser = options.browser || 'chrome'
    this.port = options.port!
  }

  private copyRecursively(sourcePath: string, targetPath: string): void {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, {recursive: true})
    }

    const entries = fs.readdirSync(sourcePath, {withFileTypes: true})

    for (const entry of entries) {
      const srcPath = path.join(sourcePath, entry.name)
      const destPath = path.join(targetPath, entry.name)

      if (entry.isDirectory()) {
        this.copyRecursively(srcPath, destPath)
      } else {
        const content = fs.readFileSync(srcPath, 'utf8')
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

    const distPath = path.dirname(compiler.options.output.path!)
    const targetPath = path.join(
      distPath,
      this.EXTENSION_OUTPUT_DIR,
      this.EXTENSIONS_DIR,
      `${this.browser}-manager`
    )

    this.copyRecursively(extensionSourcePath, targetPath)
  }

  private getPortForBrowser(basePort: number): number {
    // All browsers should use the same port that's actively running
    return basePort
  }

  private updateReloadServicePort(compiler: Compiler): void {
    const distPath = path.dirname(compiler.options.output.path!)
    const reloadServicePath = path.join(
      distPath,
      this.EXTENSION_OUTPUT_DIR,
      this.EXTENSIONS_DIR,
      `${this.browser}-manager`,
      'reload-service.js'
    )

    // Get the actual allocated port from the dev server configuration
    const devServerPort = (compiler.options.devServer as any)?.port || this.port
    const currentPort = this.getPortForBrowser(devServerPort)

    const content = fs.readFileSync(reloadServicePath, 'utf8')

    // Check if we need to update the port - either has placeholder or different port
    const portRegex = /const\s+port\s*=\s*['"](__RELOAD_PORT__|\d+)['"]/
    const match = content.match(portRegex)
    const needsUpdate =
      match &&
      (match[1] === '__RELOAD_PORT__' || parseInt(match[1]) !== currentPort)

    if (needsUpdate) {
      // Add a cache-busting comment to force reload
      const cacheBuster = `// Cache-buster: ${Date.now()}\n`
      const updatedContent =
        cacheBuster +
        content.replace(portRegex, `const port = '${currentPort}'`)
      fs.writeFileSync(reloadServicePath, updatedContent)
    } else {
      // Even if port doesn't need update, add cache-buster to force reload
      const cacheBuster = `// Cache-buster: ${Date.now()}\n`
      const updatedContent = cacheBuster + content
      fs.writeFileSync(reloadServicePath, updatedContent)
    }
  }

  apply(compiler: Compiler): void {
    const distPath = path.dirname(compiler.options.output.path!)
    const targetPath = path.join(
      distPath,
      this.EXTENSION_OUTPUT_DIR,
      this.EXTENSIONS_DIR,
      `${this.browser}-manager`
    )

    // Only copy files if the target directory doesn't exist
    if (!fs.existsSync(targetPath)) {
      this.copyExtensionFiles(compiler)
    }

    // Update port after compilation to ensure dev server port is available
    compiler.hooks.afterCompile.tap('generate-manager-extension', () => {
      this.updateReloadServicePort(compiler)
    })
  }
}

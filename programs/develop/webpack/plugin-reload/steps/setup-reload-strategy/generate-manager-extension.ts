import * as fs from 'fs'
import * as path from 'path'
import {Compiler} from '@rspack/core'
import * as messages from '../../../webpack-lib/messages'
import {type PluginInterface} from '../../reload-types'
import {DevOptions} from '../../../../module'

export class GenerateManagerExtension {
  private readonly browser: DevOptions['browser']
  private readonly EXTENSION_SOURCE_DIR = 'extensions'
  private readonly EXTENSION_OUTPUT_DIR = 'extension-js'
  private readonly EXTENSIONS_DIR = 'extensions'
  private readonly port: string | number
  private readonly instanceId?: string

  constructor(options: PluginInterface) {
    this.browser = options.browser || 'chrome'
    this.port = options.port!
    this.instanceId = options.instanceId
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
    // Resolve source assets location robustly across source and dist layouts
    const extensionSourceCandidates: string[] = []

    // 1) Installed package layout via entry point
    try {
      const entryPath = require.resolve('extension-develop')
      const distDir = path.dirname(entryPath)
      extensionSourceCandidates.push(
        path.join(
          distDir,
          this.EXTENSIONS_DIR,
          `${this.browser}-manager-extension`
        )
      )
    } catch {}

    // 2) Repo build layout (this package's dist root)
    extensionSourceCandidates.push(
      path.join(
        path.dirname(path.dirname(__dirname)),
        this.EXTENSIONS_DIR,
        `${this.browser}-manager-extension`
      )
    )

    // 3) Monorepo root layout: programs/develop/dist/extensions
    extensionSourceCandidates.push(
      path.join(
        path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))),
        'dist',
        this.EXTENSIONS_DIR,
        `${this.browser}-manager-extension`
      )
    )

    // 4) Source layout
    extensionSourceCandidates.push(
      path.join(
        path.dirname(path.dirname(path.dirname(__dirname))),
        this.EXTENSIONS_DIR,
        `${this.browser}-manager-extension`
      )
    )

    let extensionSourcePath = extensionSourceCandidates[0]

    for (const candidate of extensionSourceCandidates) {
      if (fs.existsSync(candidate)) {
        extensionSourcePath = candidate
        break
      }
    }

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

    // Replace port and instanceId placeholders then add a cache-buster
    const portRegex = /const\s+port\s*=\s*['"](__RELOAD_PORT__|\d+)['"]/
    const idRegex =
      /const\s+instanceId\s*=\s*['"](__INSTANCE_ID__|[^'"\\]+)['"]/
    let updated = content.replace(portRegex, `const port = '${currentPort}'`)
    if (this.instanceId) {
      updated = updated.replace(
        idRegex,
        `const instanceId = '${this.instanceId}'`
      )
    }
    const cacheBuster = `// Cache-buster: ${Date.now()}\n`
    fs.writeFileSync(reloadServicePath, cacheBuster + updated)
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

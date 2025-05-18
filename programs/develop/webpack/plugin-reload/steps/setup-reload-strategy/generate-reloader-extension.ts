import * as fs from 'fs'
import * as path from 'path'
import {Compilation, Compiler, sources} from '@rspack/core'
import {type PluginInterface} from '../../reload-types'
import {DevOptions} from '../../../../module'

export class GenerateReloaderExtension {
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.browser = options.browser || 'chrome'
  }

  private copyRecursively(compiler: Compiler, sourcePath: string, targetPath: string) {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true })
    }

    const entries = fs.readdirSync(sourcePath, { withFileTypes: true })

    entries.forEach(entry => {
      const srcPath = path.join(sourcePath, entry.name)
      const destPath = path.join(targetPath, entry.name)

      if (entry.isDirectory()) {
        this.copyRecursively(compiler, srcPath, destPath)
      } else {
        let content = fs.readFileSync(srcPath, 'utf8')
        
        // Replace reload port in reload-service.js
        if (entry.name === 'reload-service.js') {
            const port = compiler.options.devServer?.port?.toString() || '8080'
          content = content.replace(/__RELOAD_PORT__/g, port)
        }

        console.log('WRITING FILE.....', destPath)
        fs.writeFileSync(destPath, content)
      }
    })
  }

  private copyExtensionFiles(compiler: Compiler) {
    const extensionSourcePath = path.join(__dirname, 'extensions', `${this.browser}-manager-extension`)
    
    if (!fs.existsSync(extensionSourcePath)) {
      console.error(`Extension source folder not found at: ${extensionSourcePath}`)
      return
    }

    const outputPath = path.join(compiler.options.output.path || '', `${this.browser}-manager-extension`)
    this.copyRecursively(compiler, extensionSourcePath, outputPath)
  }

  apply(compiler: Compiler) {
    const outputPath = `${this.browser}-manager-extension`
    const targetPath = path.join(compiler.options.output.path || '', outputPath, 'reload-service.js')
    
    console.log('targetPath', targetPath)
    if (!fs.existsSync(targetPath)) {
      this.copyExtensionFiles(compiler)
    }
  }
}
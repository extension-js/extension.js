// import path from 'path'
// import fs from 'fs'
import type webpack from 'webpack'
import {type RunChromeExtensionInterface} from './types'
import SimpleReloadPlugin from './plugins/SimpleReloadPlugin'
import RunChromePlugin from './plugins/RunChromePlugin'
import createUserDataDir from './plugins/RunChromePlugin/chrome/createUserDataDir'

export default class RunChromeExtension {
  private readonly options: RunChromeExtensionInterface

  constructor(options: RunChromeExtensionInterface) {
    // User-defined options
    this.options = {
      manifestPath: options.manifestPath,
      extensionPath: options.extensionPath,
      port: options.port || 8082,
      browserFlags: options.browserFlags || [],
      userDataDir: options.userDataDir || createUserDataDir(),
      startingUrl: options.startingUrl,
      autoReload: options.autoReload != null ? options.autoReload : true
    }
  }

  // copyExtensionToOutput(extensionToCopy: string) {
  //   const sourceDir = path.resolve(`./extensions/${extensionToCopy}`)
  //   const destinationDir = path.resolve(__dirname, `./dist/extensions/${extensionToCopy}`)
  //   // Check if the source directory exists
  //   if (!fs.existsSync(sourceDir)) {
  //     console.error(`Source directory '${sourceDir}' not found.`)
  //     return
  //   }

  //   // Create the destination directory if it doesn't exist
  //   if (!fs.existsSync(destinationDir)) {
  //     fs.mkdirSync(destinationDir)
  //   }

  //   // copy folders recursively
  //   const filesToCreate = fs.readdirSync(sourceDir)

  //   filesToCreate.forEach(file => {
  //     const origFilePath = `${sourceDir}/${file}`
  //     const stats = fs.statSync(origFilePath)

  //     if (stats.isSymbolicLink()) return

  //     if (stats.isFile()) {
  //       const contents = fs.readFileSync(origFilePath, 'utf8')

  //       // Rename the extension from .js to .ts
  //       fs.writeFileSync(file, contents, 'utf8')
  //     } else if (stats.isDirectory()) {
  //       fs.mkdirSync(`${destinationDir}/${file}`)

  //       // Call recursively
  //       this.copyExtensionToOutput(extensionToCopy)
  //     }
  //   })
  // }

  apply(compiler: webpack.Compiler) {
    if (this.options.autoReload) {
      // We don't need to watch anything on production
      if (compiler.options.mode === 'production') return

      // Optional auto-reload strategy
      // this.copyExtensionToOutput('reload-extension')
      new SimpleReloadPlugin(this.options).apply(compiler)
    }

    // this.copyExtensionToOutput('manager-extension')
    // Serve extensions to the browser. At this point
    // both the reload manager extension and the user extension
    // are loaded with key files being watched.
    // Now we inject these two extensions into the browser.
    new RunChromePlugin(this.options).apply(compiler)
  }
}

import * as path from 'path'
import * as fs from 'fs'
import AdmZip from 'adm-zip'
import glob from 'tiny-glob'
import ignore from 'ignore'
import type {Compiler} from '@rspack/core'
import type {DevOptions} from '../webpack-types'

export interface ZipPluginOptions {
  manifestPath?: string
  browser: DevOptions['browser']
  zipData: {
    zip?: boolean
    zipSource?: boolean
    zipFilename?: string
  }
}

function sanitize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
}

function readJsonFileSafe(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf8')
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return JSON.parse(text)
}

const toPosix = (p: string): string => p.replace(/\\/g, '/')

async function getFilesToZip(projectDir: string): Promise<string[]> {
  const gitignorePath = path.join(projectDir, '.gitignore')
  const ig = ignore()

  try {
    const content = fs.readFileSync(gitignorePath, 'utf8')
    if (content) ig.add(content)
  } catch {
    // Ignore errors reading .gitignore
  }

  const files = await glob('**/*', {cwd: projectDir, dot: true})
  return files.filter((file) => !ig.ignores(file))
}

export class ZipPlugin {
  private readonly browser: DevOptions['browser']
  private readonly zipData: {
    zip?: boolean
    zipSource?: boolean
    zipFilename?: string
  }

  constructor(private readonly options: ZipPluginOptions) {
    this.browser = this.options.browser || 'chrome'
    this.zipData = this.options.zipData
  }

  apply(compiler: Compiler) {
    compiler.hooks.done.tapPromise('plugin-zip', async (stats) => {
      if (!(this.zipData.zip || this.zipData.zipSource)) return

      try {
        // Try to read manifest name/version from output (dist)
        // Use output.path for outDir instead of assuming dist/browser
        const outPath = compiler.options.output?.path as string
        const packageJsonDir = compiler.options.context as string

        const manifestPath = this.options.manifestPath
          ? this.options.manifestPath
          : path.join(
              this.zipData.zipSource ? packageJsonDir : outPath,
              'manifest.json'
            )

        const manifest = readJsonFileSafe(manifestPath)

        const base = sanitize(manifest.name || path.basename(packageJsonDir))
        const name = `${base}-${manifest.version || '0.0.0'}`

        if (this.zipData.zipSource) {
          const sourceZip = new AdmZip()
          const files = await getFilesToZip(packageJsonDir)
          files.forEach((file) => {
            const root = path.dirname(file)
            sourceZip.addLocalFile(
              path.join(packageJsonDir, file),
              root === '.' ? '' : toPosix(root)
            )
          })

          // "dist" before the browser name for dirname of the output path
          // For example, if outPath is "dist/chrome", then the source path
          // will be "dist/my-extension-1.0.0-source.zip"
          const sourcePath = path.join(
            path.dirname(outPath),
            `${name}-source.zip`
          )
          sourceZip.writeZip(sourcePath)
        }

        if (this.zipData.zip) {
          const distZip = new AdmZip()
          distZip.addLocalFolder(outPath)
          const filename = this.zipData.zipFilename
            ? sanitize(this.zipData.zipFilename)
            : name
          const distPath = path.join(outPath, `${filename}.zip`)

          distZip.writeZip(distPath)
        }
      } catch (error) {
        // Surface error in build output but do not crash dev builds
        if (stats?.compilation?.warnings) {
          stats.compilation.warnings.push(
            new Error(`ZipPlugin: Failed to create zip(s): ${String(error)}`)
          )
        }
      }
    })
  }
}

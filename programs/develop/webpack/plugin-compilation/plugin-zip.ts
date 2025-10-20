import * as path from 'path'
import * as fs from 'fs'
import AdmZip from 'adm-zip'
import glob from 'tiny-glob'
import ignore from 'ignore'
import type {Compiler} from '@rspack/core'

export interface ZipPluginOptions {
  projectDir: string
  browser: string
  zip?: boolean
  zipSource?: boolean
  zipFilename?: string
}

function sanitize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
}

async function getFilesToZip(projectDir: string): Promise<string[]> {
  const gitignorePath = path.join(projectDir, '.gitignore')
  const ig = ignore()
  try {
    const content = fs.readFileSync(gitignorePath, 'utf8')
    if (content) ig.add(content)
  } catch {}
  const files = await glob('**/*', {cwd: projectDir, dot: true})
  return files.filter((file) => !ig.ignores(file))
}

export class ZipPlugin {
  constructor(private readonly options: ZipPluginOptions) {}

  apply(compiler: Compiler) {
    compiler.hooks.done.tapPromise('plugin-zip', async (stats) => {
      if (!(this.options.zip || this.options.zipSource)) return

      try {
        // Try to read manifest name/version from output (dist) or project dir (for source)
        const outDir = path.join(
          this.options.projectDir,
          'dist',
          this.options.browser
        )

        const manifestPath = path.join(
          this.options.zipSource ? this.options.projectDir : outDir,
          'manifest.json'
        )

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
          name?: string
          version?: string
        }

        const base = sanitize(
          manifest.name || path.basename(this.options.projectDir)
        )
        const name = `${base}-${manifest.version || '0.0.0'}`

        if (this.options.zipSource) {
          const sourceZip = new AdmZip()
          const files = await getFilesToZip(this.options.projectDir)
          files.forEach((file) => {
            sourceZip.addLocalFile(
              path.join(this.options.projectDir, file),
              path.dirname(file)
            )
          })
          const sourcePath = path.join(
            this.options.projectDir,
            'dist',
            `${name}-source.zip`
          )
          sourceZip.writeZip(sourcePath)
        }

        if (this.options.zip) {
          const distZip = new AdmZip()
          distZip.addLocalFolder(outDir)
          const filename = this.options.zipFilename
            ? sanitize(this.options.zipFilename)
            : name
          const distPath = path.join(outDir, `${filename}.zip`)
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

import fs from 'fs'
import webpack from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'

import {type ManifestPluginInterface, type Manifest} from '../types'
import messages from '../helpers/messages'

export default class ThrowIfRecompileIsNeeded {
  public readonly manifestPath: string
  public readonly exclude?: string[]
  private initialValues: string[] = []

  constructor(options: ManifestPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
    this.initialValues = this.getFlattenedAssets(this.readManifest())
  }

  private readManifest(): Manifest {
    try {
      const manifestJson = fs.readFileSync(this.manifestPath, 'utf-8')
      return JSON.parse(manifestJson)
    } catch (error) {
      console.error('Error reading manifest file:', error)
      return {} as Manifest
    }
  }

  private getFlattenedAssets(updatedManifest?: Manifest): string[] {
    const html = manifestFields(this.manifestPath, updatedManifest).html
    const scripts = manifestFields(this.manifestPath, updatedManifest).scripts
    const htmlFields = Object.values(html).map((value) => value?.html)
    const scriptFields = Object.values(scripts).flat()
    const values = [...htmlFields, ...scriptFields].filter(
      (value) => value != null
    )

    return values as string[]
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.watchRun.tapAsync(
      'ManifestPlugin (ThrowIfRecompileIsNeeded)',
      (compiler, done) => {
        const files = compiler.modifiedFiles || new Set<string>()
        if (files.has(this.manifestPath)) {
          const updatedManifest = this.readManifest()
          const updatedValues = this.getFlattenedAssets(updatedManifest).sort()
          const initialValues = this.initialValues.sort()

          if (initialValues.toString() !== updatedValues.toString()) {
            compiler.hooks.thisCompilation.tap(
              'ManifestPlugin (ThrowIfRecompileIsNeeded)',
              (compilation) => {
                const errorMessage = messages.serverRestartRequired()
                compilation.errors.push(new webpack.WebpackError(errorMessage))
              }
            )
          }
        }
        done()
      }
    )
  }
}

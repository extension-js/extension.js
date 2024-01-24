import path from 'path'
import webpack, {Compilation} from 'webpack'
import manifestFields from 'browser-extension-manifest-fields'

import {type ManifestPluginInterface} from '../types'
import {serverRestartRequired} from '../helpers/messages'

export default class ThrowIfRecompileIsNeeded {
  public readonly manifestPath: string
  public readonly exclude?: string[]
  private initialValues: string[] = []
  private manifestChanged: boolean = false

  constructor(options: ManifestPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
    this.initialValues = this.getFlattenedAssets()
  }

  private getFlattenedAssets(
    updatedManifest?: Record<string, any | any[]>
  ): string[] {
    const html = manifestFields(this.manifestPath, updatedManifest).html
    const scripts = manifestFields(this.manifestPath, updatedManifest).scripts
    const htmlFields = Object.values(html).map((value) => value?.html)
    const scriptFields = Object.values(scripts).flat()
    const initialValues = [...htmlFields, ...scriptFields]
    const values = initialValues
      .map((value) => value || '')
      .filter((value) => value !== '')

    return values
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.watchRun.tapAsync(
      'ManifestPlugin (ThrowIfRecompileIsNeeded)',
      (compiler, done) => {
        const files = compiler.modifiedFiles || new Set<string>()
        const changedFile = Array.from(files)[0]

        if (changedFile && path.basename(changedFile) === 'manifest.json') {
          this.manifestChanged = true
        }

        done()
      }
    )

    compiler.hooks.compilation.tap(
      'ManifestPlugin (ThrowIfRecompileIsNeeded)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionJsonPlugin',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (this.manifestChanged) {
              const manifestAsset = assets['manifest.json']?.source()
              const manifest = JSON.parse(manifestAsset?.toString() || '{}')
              const initialValues = this.initialValues.sort()
              const updatedValues = this.getFlattenedAssets(manifest).sort()

              if (initialValues.toString() !== updatedValues.toString()) {
                const errorMessage = serverRestartRequired()

                compilation.errors.push(new webpack.WebpackError(errorMessage))
                this.manifestChanged = false
              }
            }
          }
        )
      }
    )
  }
}

import {type Compiler} from '@rspack/core'
import {EmitFile} from './steps/emit-file'
import {AddToFileDependencies} from './steps/add-to-file-dependencies'
import {ThrowIfManifestIconsChange} from './steps/throw-if-manifest-icons-change'
import {
  ThemeIcon,
  type FilepathList,
  type PluginInterface
} from '../../webpack-types'

/**
 * IconsPlugin is responsible for handling the icon files defined
 * in the manifest.json. It emits the icon files to the output
 * directory and adds them to the file dependencies of the compilation.
 *
 * Features supported:
 * action.default_icon
 * browser_action.default_icon
 * icons
 * page_action.default_icon
 * sidebar_action.default_icon
 */
export class IconsPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList | {[x: string]: ThemeIcon}

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
  }
  public apply(compiler: Compiler): void {
    // Normalize include keys so downstream steps can consistently
    // determine output folders and severities without relying on callers.
    const normalizeIconIncludeKeys = (icons?: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(icons || {})) {
        if (key === 'action') {
          out['action/default_icon'] = value
        } else if (key === 'browser_action') {
          out['browser_action/default_icon'] = value
        } else if (key === 'page_action') {
          out['page_action/default_icon'] = value
        } else if (key === 'sidebar_action') {
          out['sidebar_action/default_icon'] = value
        } else {
          out[key] = value
        }
      }
      return out as FilepathList
    }

    const normalizedIncludeList = normalizeIconIncludeKeys(
      this.includeList as Record<string, unknown> | undefined
    )

    new EmitFile({
      manifestPath: this.manifestPath,
      includeList: normalizedIncludeList
    }).apply(compiler)

    new AddToFileDependencies({
      manifestPath: this.manifestPath,
      includeList: normalizedIncludeList
    }).apply(compiler)

    new ThrowIfManifestIconsChange({
      manifestPath: this.manifestPath,
      includeList: normalizedIncludeList
    }).apply(compiler)
  }
}

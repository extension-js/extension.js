import {
  // getAssetOutputPath,
  getFilePathWithinFolder,
  getFilePathSplitByDots
} from './getResourceName'
import shouldExclude from './shouldExclude'
import path from 'path'

export default function getFilename(
  feature: string,
  filepath: string,
  exclude: string[]
) {
  const entryExt = path.extname(filepath)
  // Do not attempt to rewrite the asset path if it's in the exclude list.

  const shouldSkipRewrite = shouldExclude(exclude, filepath)

  // TODO: After testing HMR and ensuring the custom file path
  // works, consider making features as [feature]/folder.ext
  // instead of [feature].folder.ext. This will prettify the output.
  const fileOutputpath = shouldSkipRewrite
    ? path.normalize(filepath)
    : getFilePathSplitByDots(feature, filepath)

  const assetOutputpath = shouldSkipRewrite
    ? path.normalize(filepath)
    : getFilePathWithinFolder(feature, filepath)

  if (['.js', '.jsx', '.tsx', '.ts'].includes(entryExt)) {
    return fileOutputpath.replace(entryExt, '.js')
  }

  if (['.css', '.scss', '.sass', '.less'].includes(entryExt)) {
    return assetOutputpath.replace(entryExt, '.css')
  }

  return assetOutputpath
}

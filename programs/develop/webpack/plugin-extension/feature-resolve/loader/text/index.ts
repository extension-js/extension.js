import {TextTransformContext, isJsxLikePath} from './context'
import {
  replaceRuntimeGetURL,
  replaceObjectKeyLiterals,
  replaceStaticTemplateForKeys,
  replaceConcatForKeys,
  replaceFilesArray,
  replaceJsCssArrays
} from './replacements'
import {
  cleanupPublicRootLiterals,
  normalizeSpecialFolderExtensions,
  collapseAccidentalDoubleQuotes
} from './post'

export function textFallbackTransform(
  source: string,
  opts: TextTransformContext
): string {
  let output = String(source)
  const ctx: TextTransformContext = {
    manifestPath: opts.manifestPath,
    packageJsonDir: opts.packageJsonDir,
    authorFilePath: opts.authorFilePath,
    onResolvedLiteral: opts.onResolvedLiteral
  }

  output = replaceRuntimeGetURL(source, output, ctx)

  const supportedKeys = [
    'url',
    'file',
    'path',
    'iconUrl',
    'imageUrl',
    'default_icon'
  ]
  output = replaceObjectKeyLiterals(source, output, supportedKeys, ctx)
  output = replaceStaticTemplateForKeys(source, output, supportedKeys, ctx)
  output = replaceConcatForKeys(source, output, supportedKeys, ctx)
  output = replaceFilesArray(source, output, ctx)
  output = replaceJsCssArrays(source, output, ctx)

  if (!isJsxLikePath(opts.authorFilePath)) {
    output = cleanupPublicRootLiterals(output)
  }
  output = normalizeSpecialFolderExtensions(output)
  output = collapseAccidentalDoubleQuotes(output, supportedKeys)

  return output
}

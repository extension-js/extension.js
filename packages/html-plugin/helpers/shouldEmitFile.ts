import path from 'path'
import shouldExclude from './shouldExclude'

export default function shouldEmitFile(
  context: string,
  file: string,
  exclude: string[] | undefined
) {
  if (!exclude) return false

  const contextFile = path.relative(context, file)
  const shouldExcludeFile = shouldExclude(exclude, contextFile)

  // if there are no exclude folder, exclude nothing
  if (shouldExcludeFile) return false

  return true
}

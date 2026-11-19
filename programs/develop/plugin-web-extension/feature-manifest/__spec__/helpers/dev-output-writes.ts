import type {Compiler} from '@rspack/core'
import {shouldWriteAssetToDisk} from '../../../../dev-server/server-config'

interface WritableOutputFs {
  writeFile?: (filePath: string, ...args: unknown[]) => unknown
}

// A dev session writes output through the dev middleware, which asks this
// same rule per file, so the persist step alone writes the root manifest.
export function writeOutputAsADevSessionDoes(
  compiler: Compiler,
  outputPath: string
): () => void {
  const outputFileSystem = compiler.outputFileSystem as WritableOutputFs | null
  const writeFile = outputFileSystem?.writeFile

  if (!outputFileSystem || typeof writeFile !== 'function') return () => {}

  outputFileSystem.writeFile = (filePath: string, ...args: unknown[]) => {
    if (shouldWriteAssetToDisk(filePath, outputPath)) {
      return writeFile.call(outputFileSystem, filePath, ...args)
    }

    const callback = args[args.length - 1]
    if (typeof callback === 'function') callback(null)

    return undefined
  }

  // rspack hands every compiler the same file system, so put it back.
  return () => {
    outputFileSystem.writeFile = writeFile
  }
}

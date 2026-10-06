// ███████╗████████╗ █████╗ ████████╗██╗ ██████╗  █████╗ ███████╗███████╗███████╗████████╗███████╗
// ██╔════╝╚══██╔══╝██╔══██╗╚══██╔══╝██║██╔════╝ ██╔══██╗██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔════╝
// ███████╗   ██║   ███████║   ██║   ██║██║█████╗███████║███████╗███████╗█████╗     ██║   ███████╗
// ╚════██║   ██║   ██╔══██║   ██║   ██║██║╚════╝██╔══██║╚════██║╚════██║██╔══╝     ██║   ╚════██║
// ███████║   ██║   ██║  ██║   ██║   ██║╚██████╗ ██║  ██║███████║███████║███████╗   ██║   ███████║
// ╚══════╝   ╚═╝   ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {util} from '@rspack/core'

// Content-hash in DEV too: same-basename assets in different folders collided
// on one output name; hashing, not [path], which can escape the output dir.
export const ASSET_FILENAME_PATTERN = 'assets/[name].[contenthash:8][ext]'

export interface AssetHashOptions {
  hashFunction?: string
  hashSalt?: string
  hashDigest?: string
  hashDigestLength?: number
}

// The name the bundler gives a file its asset rules emit, computed the way
// rspack renders [contenthash], so another emitter can share that one copy.
export function bundledAssetOutputName(
  absolutePath: string,
  content: Buffer,
  output: AssetHashOptions = {}
): string {
  const hash = util.createHash(output.hashFunction || 'xxhash64')

  if (output.hashSalt) hash.update(output.hashSalt, 'utf-8')

  hash.update(content)

  const digest = hash
    .digest(output.hashDigest || 'hex')
    .slice(0, Math.min(8, output.hashDigestLength || 16))
  const ext = path.extname(absolutePath)

  return ASSET_FILENAME_PATTERN.replace(
    '[name]',
    path.basename(absolutePath, ext)
  )
    .replace('[contenthash:8]', digest)
    .replace('[ext]', ext)
}

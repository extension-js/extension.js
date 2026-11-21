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

export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'ico',
  'bmp'
]
export const FONT_EXTENSIONS = ['woff', 'woff2', 'eot', 'ttf', 'otf']
export const FILE_EXTENSIONS = [
  'txt',
  'md',
  'csv',
  'tsv',
  'xml',
  'pdf',
  'docx',
  'doc',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'gz',
  'gzip',
  'tgz'
]

const CLAIMED_EXTENSIONS = new Set([
  'svg',
  ...IMAGE_EXTENSIONS,
  ...FONT_EXTENSIONS,
  ...FILE_EXTENSIONS
])

export interface AssetHashOptions {
  hashFunction?: unknown
  hashSalt?: string
  hashDigest?: string
  hashDigestLength?: number
  assetModuleFilename?: unknown
}

const RENDERABLE = /\[(name|ext|base|(?:content)?hash(?::\d+)?)\]/g

// The pattern a file of this extension is emitted under. A file no default
// rule claims follows output.assetModuleFilename when its tokens are known.
function patternFor(ext: string, output: AssetHashOptions): string {
  const own = output.assetModuleFilename

  if (CLAIMED_EXTENSIONS.has(ext.slice(1).toLowerCase())) {
    return ASSET_FILENAME_PATTERN
  }

  if (typeof own !== 'string' || /\[/.test(own.replace(RENDERABLE, ''))) {
    return ASSET_FILENAME_PATTERN
  }

  return own
}

// The name the bundler gives a file its asset rules emit, computed the way
// rspack renders [contenthash], so another emitter can share that one copy.
export function bundledAssetOutputName(
  absolutePath: string,
  content: Buffer,
  output: AssetHashOptions = {}
): string {
  const hashFunction =
    typeof output.hashFunction === 'string' ? output.hashFunction : 'xxhash64'
  const hash = util.createHash(hashFunction)

  if (output.hashSalt) hash.update(output.hashSalt, 'utf-8')

  hash.update(content)

  const digest = String(hash.digest(output.hashDigest || 'hex'))
  const fullLength = output.hashDigestLength || 16
  const ext = path.extname(absolutePath)
  const name = path.basename(absolutePath, ext)

  return patternFor(ext, output).replace(RENDERABLE, (_token, key: string) => {
    const [kind, length] = key.split(':')

    if (kind === 'name') return name
    if (kind === 'ext') return ext
    if (kind === 'base') return `${name}${ext}`

    return digest.slice(0, Math.min(Number(length) || fullLength, fullLength))
  })
}

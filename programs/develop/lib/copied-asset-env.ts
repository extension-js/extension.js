import {isUtf8} from 'node:buffer'

export interface EnvAssetTemplater {
  template: (filename: string, text: string) => string
  // Told about a file that holds a placeholder and cannot be read as UTF-8.
  leaveNotUtf8: (filename: string) => void
}

const templaters = new WeakMap<object, EnvAssetTemplater>()

const TEMPLATED_ASSET = /\.(?:json|html)$/

const PLACEHOLDER_START = '$EXTENSION_'
const PLACEHOLDER_BYTES = Buffer.from(PLACEHOLDER_START, 'utf8')
const WIDE_PLACEHOLDER_BYTES = [
  Buffer.from(PLACEHOLDER_START, 'utf16le'),
  Buffer.from(PLACEHOLDER_START, 'utf16le').swap16()
]

export function isEnvTemplatedAsset(filename: string): boolean {
  return TEMPLATED_ASSET.test(filename)
}

export function setEnvAssetTemplater(
  compilation: object,
  templater: EnvAssetTemplater
): void {
  templaters.set(compilation, templater)
}

// The placeholder is looked for in the bytes, so a file without one is never
// decoded and the same buffer goes back. One that is not UTF-8 goes back too.
export function templateAssetBytes(
  templater: EnvAssetTemplater,
  filename: string,
  content: Buffer
): Buffer {
  if (!content.includes(PLACEHOLDER_BYTES)) {
    if (WIDE_PLACEHOLDER_BYTES.some((bytes) => content.includes(bytes))) {
      templater.leaveNotUtf8(filename)
    }

    return content
  }

  if (!isUtf8(content)) {
    templater.leaveNotUtf8(filename)

    return content
  }

  const text = content.toString('utf8')
  const templated = templater.template(filename, text)

  return templated === text ? content : Buffer.from(templated, 'utf8')
}

export function templateCopiedAsset(
  compilation: object,
  filename: string,
  content: Buffer
): Buffer {
  const templater = templaters.get(compilation)
  if (!templater || !isEnvTemplatedAsset(filename)) return content

  return templateAssetBytes(templater, filename, content)
}

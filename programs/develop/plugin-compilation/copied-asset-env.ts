type AssetTemplater = (filename: string, text: string) => string

const templaters = new WeakMap<object, AssetTemplater>()

const TEMPLATED_ASSET = /\.(?:json|html)$/

export function isEnvTemplatedAsset(filename: string): boolean {
  return TEMPLATED_ASSET.test(filename)
}

export function setEnvAssetTemplater(
  compilation: object,
  templater: AssetTemplater
): void {
  templaters.set(compilation, templater)
}

// A file without a placeholder keeps its exact bytes, so only the copies
// that carry one change.
export function templateCopiedAsset(
  compilation: object,
  filename: string,
  content: Buffer
): Buffer {
  const templater = templaters.get(compilation)
  if (!templater || !isEnvTemplatedAsset(filename)) return content

  const text = content.toString('utf8')
  if (!text.includes('$EXTENSION_')) return content

  const templated = templater(filename, text)

  return templated === text ? content : Buffer.from(templated, 'utf8')
}

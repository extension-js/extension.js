import * as fs from 'fs'
import * as path from 'path'
import {createHash} from 'crypto'

type OptionalDependenciesMap = Record<string, string>

function getOptionalDependenciesPath(): string {
  const candidates = [
    path.join(__dirname, 'optional-dependencies.json'),
    path.resolve(
      __dirname,
      '..',
      'webpack',
      'webpack-lib',
      'optional-dependencies.json'
    )
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  return candidates[0]
}

export function loadOptionalDependencies(): OptionalDependenciesMap {
  const metadataPath = getOptionalDependenciesPath()

  if (!fs.existsSync(metadataPath)) {
    throw new Error(
      `optional-dependencies.json not found at ${metadataPath}. This indicates a corrupted installation.`
    )
  }

  try {
    const content = fs.readFileSync(metadataPath, 'utf8')
    const parsed = JSON.parse(content)

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('optional-dependencies.json must contain an object')
    }

    return parsed as OptionalDependenciesMap
  } catch (error: any) {
    throw new Error(
      `Failed to load optional-dependencies.json: ${error.message}`
    )
  }
}

export function resolveOptionalDependencySpecs(
  dependencies: string[]
): string[] {
  const metadata = loadOptionalDependencies()
  const missingFromMetadata = dependencies.filter((dep) => !(dep in metadata))

  if (missingFromMetadata.length > 0) {
    throw new Error(
      `Dependencies not found in optional-dependencies.json: ${missingFromMetadata.join(', ')}`
    )
  }

  return dependencies.map((dep) => `${dep}@${metadata[dep]}`)
}

export function getOptionalDependenciesSignature(): string {
  const metadata = loadOptionalDependencies()
  const stable = JSON.stringify(
    Object.keys(metadata)
      .sort()
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = metadata[key]
        return acc
      }, {})
  )

  return createHash('sha1').update(stable).digest('hex')
}

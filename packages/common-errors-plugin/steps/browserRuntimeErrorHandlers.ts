import webpack from 'webpack'
import parseCSP from 'content-security-policy-parser'

export function handleInsecureCSPValue(
  manifestPath: string
): webpack.WebpackError | null {
  const manifest = require(manifestPath)
  const manifestCSP: string | undefined = manifest.content_security_policy
  const extensionPagesCSP: string | undefined =
    manifest.content_security_policy?.extension_pages

  const checkCSP = (cspString: string | undefined): string | undefined => {
    if (!cspString) return undefined
    const parsedCSP = parseCSP(cspString)

    if (
      parsedCSP['script-src'] &&
      parsedCSP['script-src'].includes("'unsafe-eval'")
    ) {
      return `[manifest.json]: Insecure CSP value "'unsafe-eval'" in directive 'script-src'.`
    }
  }

  if (manifest.manifest_version === 3) {
    const extensionPagesCSPError = manifestCSP
      ? checkCSP(extensionPagesCSP)
      : undefined

    if (extensionPagesCSPError) {
      return new webpack.WebpackError(extensionPagesCSPError)
    }
  }

  return null
}

export function handleWrongWebResourceFormatError(
  manifestPath: string
): webpack.WebpackError | null {
  const manifest = require(manifestPath)
  const webResources = manifest.web_accessible_resources as string[]

  if (webResources) {
    const mv2Format = webResources.some((resource: string) => {
      return typeof resource === 'string'
    })

    const mv3Format = webResources.some((resource: any) => {
      return (
        typeof resource === 'object' || resource.resources || resource.matches
      )
    })

    if (manifest.manifest_version === 2 && !mv2Format) {
      return new webpack.WebpackError(
        `[manifest.json]: web_accessible_resources must be a string array in Manifest V2`
      )
    }

    if (manifest.manifest_version === 3 && !mv3Format) {
      return new webpack.WebpackError(
        `[manifest.json]: web_accessible_resources must be an array of objects in Manifest V3`
      )
    }
  }

  return null
}

// private handleBrowserRuntimeErrors(compilation: webpack.Compilation) {
//   const insecureCSPValueError = handleInsecureCSPValue(this.manifestPath)
//   const wrongWebResourceFormatError = handleWrongWebResourceFormatError(
//     this.manifestPath
//   )

//   if (insecureCSPValueError) {
//     compilation.errors.push(insecureCSPValueError)
//   }

//   if (wrongWebResourceFormatError) {
//     compilation.errors.push(wrongWebResourceFormatError)
//   }
// }

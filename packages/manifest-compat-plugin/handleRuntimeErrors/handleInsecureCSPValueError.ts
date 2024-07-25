import webpack from 'webpack'
import parseCSP from 'content-security-policy-parser'
import {bold, cyan, yellow, blue} from '@colors/colors'
import {type ManifestBase} from '../manifest-types'

export default function handleInsecureCSPValueError(
  manifest: ManifestBase
): webpack.WebpackError | null {
  const manifestCSP: string | undefined = manifest.content_security_policy
  const extensionPagesCSP: string | undefined =
    manifest.content_security_policy?.extension_pages

  const checkCSP = (cspString: string | undefined): string | undefined => {
    if (!cspString) return undefined
    const parsedCSP = parseCSP(cspString)

    if (
      parsedCSP.get('script-src') &&
      parsedCSP.get('script-src')?.includes("'unsafe-eval'")
    ) {
      return `[manifest.json]: Insecure ${yellow(
        'content-security-policy'
      )} value "'${cyan('unsafe-eval')}'" in directive '${blue('script-src')}'.`
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

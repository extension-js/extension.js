import {WebpackError} from '@rspack/core'
import parseCSP from 'content-security-policy-parser'
import * as messages from '../../lib/messages'
import {type Manifest} from '../../webpack-types'

export function insecureCSPValueError(manifest: Manifest) {
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
      const manifestName = manifest.name || 'Extension.js'
      return messages.insecurePolicy(manifestName)
    }
  }

  if (manifest.manifest_version === 3) {
    const extensionPagesCSPError = manifestCSP
      ? checkCSP(extensionPagesCSP)
      : undefined

    if (extensionPagesCSPError) {
      return new WebpackError(extensionPagesCSPError)
    }
  }

  return null
}

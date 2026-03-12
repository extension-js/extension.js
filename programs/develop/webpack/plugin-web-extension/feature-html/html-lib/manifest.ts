// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Compilation} from '@rspack/core'
import type {Manifest, DevOptions} from '../../../webpack-types'
import {
  getManifestContent as getSharedManifestContent,
  filterKeysForThisBrowser as filterManifestKeysForBrowser,
  setOriginalManifestContent as setSharedOriginalManifestContent,
  getOriginalManifestContent as getSharedOriginalManifestContent
} from '../../feature-manifest/manifest-lib/manifest'

export function getManifestContent(
  compilation: Compilation,
  manifestPath: string
): Manifest {
  return getSharedManifestContent(compilation, manifestPath)
}

export function filterKeysForThisBrowser(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  return filterManifestKeysForBrowser(manifest, browser)
}

export function setOriginalManifestContent(
  compilation: Compilation,
  source: string
): void {
  setSharedOriginalManifestContent(compilation, source)
}

export function getOriginalManifestContent(
  compilation: Compilation
): string | undefined {
  return getSharedOriginalManifestContent(compilation)
}

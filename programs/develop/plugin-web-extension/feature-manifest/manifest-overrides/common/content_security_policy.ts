// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'

// MV2: string
// MV3: { extension_pages?: string; sandbox?: string }
// Chrome refuses an MV3 extension outright over the string form, and under
// --load-extension that refusal is a native modal with nothing in the log.
export function hasMv3StringPolicy(manifest: Manifest) {
  if (Number(manifest.manifest_version) !== 3) return false

  return typeof manifest.content_security_policy === 'string'
}

// The mv2 override turns the object form into the string MV2 reads; this is
// the mirror, folding the MV2 spelling into the slot MV3 reads it from.
export function contentSecurityPolicy(manifest: Manifest) {
  if (!manifest.content_security_policy) return undefined

  if (hasMv3StringPolicy(manifest)) {
    return {
      content_security_policy: {
        extension_pages: manifest.content_security_policy as string
      } as unknown
    }
  }

  return {
    content_security_policy: manifest.content_security_policy as unknown
  }
}

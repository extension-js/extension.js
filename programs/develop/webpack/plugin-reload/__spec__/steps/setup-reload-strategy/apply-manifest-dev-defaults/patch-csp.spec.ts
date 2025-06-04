import {describe, it, expect} from 'vitest'
import {
  patchV2CSP,
  patchV3CSP
} from '../../../../steps/setup-reload-strategy/apply-manifest-dev-defaults/patch-csp'
import {Manifest} from '../../../../../webpack-types'

describe('CSP Patching Functions', () => {
  describe('patchV2CSP', () => {
    it('should return default V2 CSP if none is provided', () => {
      const manifest: Manifest = {}
      const result = patchV2CSP(manifest)
      const expected =
        "script-src 'self' 'unsafe-eval' blob: filesystem:; object-src 'self' blob: filesystem:; "
      expect(result).toEqual(expected)
    })

    it('should modify script-src and object-src correctly when policy is missing', () => {
      const manifest: Manifest = {
        content_security_policy: "script-src 'self'; object-src 'self';"
      }
      const result = patchV2CSP(manifest)
      const expected =
        "script-src 'self' 'unsafe-eval' blob: filesystem:; object-src 'self' blob: filesystem:; "
      expect(result).toEqual(expected)
    })

    it('should append missing directives to script-src', () => {
      const manifest: Manifest = {
        content_security_policy: "script-src 'self';"
      }
      const result = patchV2CSP(manifest)
      const expected =
        "script-src 'self' 'unsafe-eval' blob: filesystem:; object-src 'self' blob: filesystem:; "
      expect(result).toEqual(expected)
    })

    it('should not duplicate existing directives', () => {
      const manifest: Manifest = {
        content_security_policy:
          "script-src 'self' 'unsafe-eval' blob: filesystem:; object-src 'self' blob: filesystem:; "
      }
      const result = patchV2CSP(manifest)
      const expected =
        "script-src 'self' 'unsafe-eval' blob: filesystem:; object-src 'self' blob: filesystem:; "
      expect(result).toEqual(expected)
    })
  })

  describe('patchV3CSP', () => {
    it('should return default V3 CSP if none is provided', () => {
      const manifest: Manifest = {}
      const result = patchV3CSP(manifest)
      expect(result).toEqual({
        extension_pages: "script-src 'self'; object-src 'self'; "
      })
    })

    it('should modify extension_pages policy correctly', () => {
      const manifest: Manifest = {
        content_security_policy: {
          extension_pages: "script-src 'self';"
        } as any
      }
      const result = patchV3CSP(manifest)
      expect(result).toEqual({
        extension_pages: "script-src 'self'; object-src 'self'; "
      })
    })

    it('should not modify extension_pages policy if all directives are present', () => {
      const manifest: Manifest = {
        content_security_policy: {
          extension_pages: "script-src 'self'; object-src 'self';"
        } as any
      }
      const result = patchV3CSP(manifest)
      expect(result).toEqual({
        extension_pages: "script-src 'self'; object-src 'self'; "
      })
    })
  })
})

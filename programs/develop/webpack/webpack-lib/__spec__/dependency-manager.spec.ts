import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../ensure-dependencies', () => ({
  ensureDependencies: vi.fn(async () => ({
    installed: false,
    installedBuild: false,
    installedUser: false
  }))
}))

vi.mock('../check-build-dependencies', () => ({
  findExtensionDevelopRoot: () => undefined
}))

vi.mock('../preflight-optional-deps', () => ({
  preflightOptionalDependencies: vi.fn(async () => {}),
  shouldRunOptionalPreflight: vi.fn(() => true)
}))

import {ensureProjectReady} from '../dependency-manager'
import * as depsMod from '../ensure-dependencies'
import * as preflightMod from '../preflight-optional-deps'

describe('dependency-manager', () => {
  beforeEach(() => {
    ;(depsMod.ensureDependencies as any).mockClear?.()
    ;(preflightMod.preflightOptionalDependencies as any).mockClear?.()
    ;(preflightMod.shouldRunOptionalPreflight as any).mockClear?.()
  })

  it('skips optional deps when installOptionalDeps is false', async () => {
    await ensureProjectReady(
      {
        manifestPath: '/proj/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      'development',
      {installOptionalDeps: false}
    )

    expect(preflightMod.preflightOptionalDependencies).not.toHaveBeenCalled()
  })

  it('does not block when backgroundOptionalDeps is true', async () => {
    let resolvePending: (() => void) | undefined
    ;(preflightMod.preflightOptionalDependencies as any).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePending = resolve
        })
    )

    await ensureProjectReady(
      {
        manifestPath: '/proj/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      'development',
      {backgroundOptionalDeps: true}
    )

    expect(preflightMod.preflightOptionalDependencies).toHaveBeenCalled()
    resolvePending?.()
  })
})

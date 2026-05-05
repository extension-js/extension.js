import {describe, expect, it} from 'vitest'
import {CDPExtensionController} from '../../run-chromium/chromium-source-inspection/cdp-extension-controller'

function buildExpression(bundleId: string, allowCoarseCleanup: boolean) {
  const controller = new CDPExtensionController({
    outPath: '/tmp/extension.js-fake-out',
    browser: 'chrome',
    cdpPort: 0
  }) as any
  controller.extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  return controller.buildReinjectExpression(
    bundleId,
    '/* user bundle source */',
    allowCoarseCleanup
  ) as string
}

describe('CDPExtensionController coarse cleanup is bundle-scoped', () => {
  it('uses keyedSelector (data-extjs-reinject-key="<bundleId>") for the coarse sweep, not the broad rootSelector', () => {
    const expr = buildExpression('content_scripts/content-0', true)

    // The coarse cleanup MUST scope its querySelector to this bundle's key.
    // Anchored to the conditional branch text so a future regression that
    // re-broadens to `rootSelector` is caught.
    expect(expr).toMatch(/if \(true\) \{[\s\S]*?staleKeyed/)
    expect(expr).toMatch(
      /querySelectorAll\(keyedSelector\)[\s\S]*?root\.remove/
    )
    expect(expr).toContain(
      'const keyedSelector = \'[data-extjs-reinject-key="content_scripts/content-0"]\''
    )

    // Regression guard: the cleanup branch must NOT call
    // querySelectorAll(rootSelector). The wider selector matches every
    // [data-extension-root] on the page, so doing that inside the cleanup
    // wipes sibling content_scripts entries' roots.
    const ifTrueBlock = expr.match(/if \(true\) \{[\s\S]*?\n  \}/)?.[0] || ''
    expect(ifTrueBlock).not.toMatch(/querySelectorAll\(rootSelector\)/)
  })

  it('skips the coarse sweep entirely when allowCoarseCleanup is false', () => {
    const expr = buildExpression('content_scripts/content-1', false)

    // Generated source guards the sweep with `if (false) { ... }` so dead-
    // code elimination would no-op it; either way, the test must confirm
    // the cleanup block is gated and not called unconditionally.
    expect(expr).toMatch(/if \(false\) \{[\s\S]*?staleKeyed/)
    expect(expr).not.toMatch(/if \(true\) \{[\s\S]*?staleKeyed/)
  })

  it('keys the sweep selector to the requested bundleId so siblings stay alive', () => {
    const a = buildExpression('content_scripts/content-1', true)
    const b = buildExpression('content_scripts/content-2', true)

    expect(a).toContain(
      'const keyedSelector = \'[data-extjs-reinject-key="content_scripts/content-1"]\''
    )
    expect(b).toContain(
      'const keyedSelector = \'[data-extjs-reinject-key="content_scripts/content-2"]\''
    )
    // Each bundle's expression must use ONLY its own bundleId in the
    // keyedSelector — no cross-bundle leakage.
    expect(a).not.toContain('content_scripts/content-2')
    expect(b).not.toContain('content_scripts/content-1')
  })
})

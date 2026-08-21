import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

// A flag can be declared, validated, rejected for the wrong browser, and still
// do nothing, because `build` hands the packager an explicit object literal
// rather than spreading its options the way `dev` does. That is exactly how
// --development-team shipped inert: its unit spec passed, the CLI accepted it,
// and the build came out ad-hoc signed. This guard reads the source and
// asserts every Safari-only option that build.ts knows about also reaches the
// call, so the next flag added to that list cannot repeat it.
const commands = join(__dirname, '..')
const buildSrc = readFileSync(join(commands, 'build.ts'), 'utf-8')
const devSrc = readFileSync(join(commands, 'dev.ts'), 'utf-8')

// Options whose whole effect is in the CLI layer, so they are deliberately
// not forwarded under these names.
const HANDLED_LOCALLY = new Set(['open', 'forceRegenerate', 'macosOnly'])

function declaredSafariOptions(src: string): string[] {
  const block = src.slice(
    src.indexOf('const safariOnlyFlags'),
    src.indexOf('.filter(', src.indexOf('const safariOnlyFlags'))
  )
  const props = [...block.matchAll(/\.(\w+)\]/g)].map((m) => m[1])
  expect(props.length).toBeGreaterThan(3)
  return props
}

describe('safari-only flags reach the build', () => {
  it('forwards every Safari option build.ts declares', () => {
    const forwarded = buildSrc.slice(
      buildSrc.indexOf('appName: buildOptions.appName'),
      buildSrc.indexOf('safariPackager:')
    )
    const missing = declaredSafariOptions(buildSrc)
      .filter((p) => !HANDLED_LOCALLY.has(p))
      .filter((p) => !forwarded.includes(`${p}:`))
    expect(missing).toEqual([])
  })

  it('names --development-team explicitly, the flag that regressed', () => {
    expect(buildSrc).toContain('developmentTeam: buildOptions.developmentTeam')
    // dev.ts forwards by spreading devOptions, so the flag only has to be
    // declared there. If that spread is ever replaced by a literal, this
    // assertion is the reminder to add the property.
    expect(devSrc).toContain('...devOptions')
    expect(devSrc).toContain('--development-team')
  })
})

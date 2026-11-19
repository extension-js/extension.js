import {describe, expectTypeOf, it} from 'vitest'
import type {Manifest} from '../../../../types'
import {omnibox} from '../common/omnibox'
import {themeExperiment} from '../mv2/theme_experiment'

// Type assertions: the test runner only loads them, and the spec typecheck
// (tsconfig.spec.json) is the gate a wrong type fails.
describe('manifest-overrides type contract', () => {
  it('omnibox carries a typed default_icon (string | per-size record)', () => {
    expectTypeOf<
      NonNullable<Manifest['omnibox']>['default_icon']
    >().toEqualTypeOf<string | Record<string, string> | undefined>()

    expectTypeOf(omnibox).parameter(0).toEqualTypeOf<Manifest>()
  })

  it('content_scripts entries expose string[] css/js', () => {
    type Entry = NonNullable<Manifest['content_scripts']>[number]
    expectTypeOf<Entry['css']>().toEqualTypeOf<string[] | undefined>()
    expectTypeOf<Entry['js']>().toEqualTypeOf<string[] | undefined>()
  })

  it('host_permissions is a typed string[] on the Manifest', () => {
    expectTypeOf<Manifest['host_permissions']>().toEqualTypeOf<
      string[] | undefined
    >()
  })

  it('theme_experiment is a typed Firefox key, not any', () => {
    expectTypeOf<
      NonNullable<Manifest['theme_experiment']>['stylesheet']
    >().toEqualTypeOf<string | undefined>()

    expectTypeOf(themeExperiment).parameter(0).toEqualTypeOf<Manifest>()
  })
})

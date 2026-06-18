// Type-level contract: the manifest-overrides surface reads real `Manifest`
// fields instead of `as any`. These `expectTypeOf` assertions fail to compile
// if the canonical `Manifest` type ever loses the shapes the overrides depend
// on (omnibox.default_icon, content_scripts[].css/js, host_permissions,
// theme_experiment), guarding against a silent regression back to `as any`.
import {describe, it, expectTypeOf} from 'vitest'
import {type Manifest} from '../../../../types'
import {omnibox} from '../common/omnibox'
import {hostPermissions} from '../mv3/host_permissions'
import {themeExperiment} from '../mv2/theme_experiment'

describe('manifest-overrides type contract', () => {
  it('omnibox carries a typed default_icon (string | per-size record)', () => {
    expectTypeOf<NonNullable<Manifest['omnibox']>['default_icon']>().toEqualTypeOf<
      string | Record<string, string> | undefined
    >()
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
    expectTypeOf(hostPermissions).parameter(0).toEqualTypeOf<Manifest>()
  })

  it('theme_experiment is a typed Firefox key, not any', () => {
    expectTypeOf<NonNullable<Manifest['theme_experiment']>['stylesheet']>()
      .toEqualTypeOf<string | undefined>()
    expectTypeOf(themeExperiment).parameter(0).toEqualTypeOf<Manifest>()
  })
})

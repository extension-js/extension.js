import {TEMPLATE_ALIASES as CREATE_ALIASES} from 'extension-create'
import {describe, expect, it} from 'vitest'
import {listTemplates, TEMPLATE_ALIASES} from '../helpers/template-catalog'

// One rename, two lists, and no runtime edge between them.
//
// extension-create owns the resolver, because it is what downloads a template.
// The CLI owns the listing, because it is what renders help. They were briefly
// wired together by an import, which made every `extension <anything>` require
// extension-create's build output just to print help and broke the bundled
// extension build. Holding them together here costs nothing at runtime and
// fails loudly the moment one gains a name the other lacks.
describe('template aliases agree across the packages that own them', () => {
  it('lists exactly the aliases the resolver resolves', () => {
    const listed = Object.fromEntries(
      TEMPLATE_ALIASES.map((alias) => [alias.name, alias.resolvesTo])
    )
    expect(listed).toEqual({...CREATE_ALIASES})
  })

  it('resolves every alias to a name the catalog actually publishes', () => {
    const names = listTemplates()
    for (const alias of TEMPLATE_ALIASES) {
      expect(names, `${alias.name} -> ${alias.resolvesTo}`).toContain(
        alias.resolvesTo
      )
      // An alias is the OLD name. Advertising it as a catalog name would offer
      // two names for one template and teach the retired one.
      expect(names).not.toContain(alias.name)
    }
  })

  it('never points an alias at itself', () => {
    for (const alias of TEMPLATE_ALIASES) {
      expect(alias.resolvesTo).not.toBe(alias.name)
    }
  })
})

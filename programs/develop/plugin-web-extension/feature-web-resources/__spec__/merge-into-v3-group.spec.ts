import {describe, expect, it} from 'vitest'
import {mergeIntoV3Group} from '../web-resources-lib/generate-manifest'

type Group = {resources: string[]; matches: string[]}

describe('mergeIntoV3Group', () => {
  it('creates a new group when no group matches', () => {
    const groups: Group[] = []
    mergeIntoV3Group(groups, ['https://example.com/*'], ['b.png', 'a.png'])

    expect(groups).toEqual([
      {resources: ['a.png', 'b.png'], matches: ['https://example.com/*']}
    ])
  })

  it('merges into an existing group with the same match set (order-insensitive)', () => {
    const groups: Group[] = [
      {resources: ['a.png'], matches: ['https://b.com/*', 'https://a.com/*']}
    ]
    mergeIntoV3Group(
      groups,
      ['https://a.com/*', 'https://b.com/*'],
      ['c.png', 'a.png']
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].resources).toEqual(['a.png', 'c.png'])
  })

  it('creates a separate group when match sets differ', () => {
    const groups: Group[] = [
      {resources: ['a.png'], matches: ['https://a.com/*']}
    ]
    mergeIntoV3Group(groups, ['https://b.com/*'], ['b.png'])

    expect(groups).toHaveLength(2)
  })

  it('skips resources already present in the target group', () => {
    const groups: Group[] = [{resources: ['a.png'], matches: ['<all_urls>']}]
    mergeIntoV3Group(groups, ['<all_urls>'], ['a.png', 'b.png'])

    expect(groups[0].resources).toEqual(['a.png', 'b.png'])
  })

  it('skips resources already covered by an existing glob', () => {
    const groups: Group[] = [{resources: ['assets/*'], matches: ['<all_urls>']}]
    mergeIntoV3Group(groups, ['<all_urls>'], ['assets/logo.png', 'other.png'])

    expect(groups[0].resources).toEqual(['assets/*', 'other.png'])
  })

  it('is a no-op for an empty resource list', () => {
    const groups: Group[] = []
    mergeIntoV3Group(groups, ['<all_urls>'], [])
    expect(groups).toEqual([])
  })

  it('does not create a group when createGroupWhenMissing is false', () => {
    const groups: Group[] = []
    mergeIntoV3Group(groups, [], ['a.png'], {createGroupWhenMissing: false})
    expect(groups).toEqual([])
  })

  it('still merges into an existing group when createGroupWhenMissing is false', () => {
    const groups: Group[] = [{resources: ['a.png'], matches: []}]
    mergeIntoV3Group(groups, [], ['b.png'], {createGroupWhenMissing: false})

    expect(groups).toHaveLength(1)
    expect(groups[0].resources).toEqual(['a.png', 'b.png'])
  })

  // use_dynamic_url changes how a resource is addressed, and the bundler
  // compiled a static runtime.getURL for what it emitted, so an emitted asset
  // that inherits the flag becomes unreachable on a green build.
  it('gives generated assets their own group beside a use_dynamic_url group', () => {
    const groups: Array<Group & {use_dynamic_url?: boolean}> = [
      {
        resources: ['img/a.png'],
        matches: ['https://e.com/*'],
        use_dynamic_url: true
      }
    ]
    mergeIntoV3Group(groups, ['https://e.com/*'], ['assets/logo.abc.png'])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual({
      resources: ['img/a.png'],
      matches: ['https://e.com/*'],
      use_dynamic_url: true
    })

    expect(groups[1]).toEqual({
      resources: ['assets/logo.abc.png'],
      matches: ['https://e.com/*']
    })
  })

  it('does the same for an extension_ids group', () => {
    const groups: Array<Group & {extension_ids?: string[]}> = [
      {resources: ['img/a.png'], matches: [], extension_ids: ['abc']}
    ]
    mergeIntoV3Group(groups, [], ['assets/logo.abc.png'], {
      createGroupWhenMissing: false
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].resources).toEqual(['img/a.png'])
  })

  it('still merges into a plain group with the same matches', () => {
    const groups: Group[] = [
      {resources: ['img/a.png'], matches: ['https://e.com/*']}
    ]
    mergeIntoV3Group(groups, ['https://e.com/*'], ['assets/logo.abc.png'])

    expect(groups).toHaveLength(1)
    expect(groups[0].resources).toEqual(['assets/logo.abc.png', 'img/a.png'])
  })
})

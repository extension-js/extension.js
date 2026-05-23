import {describe, expect, it} from 'vitest'
import {mergeIntoV3Group} from '../web-resources-lib/generate-manifest'

type Group = {resources: string[]; matches: string[]}

describe('mergeIntoV3Group', () => {
  it('creates a new group when no group matches', () => {
    const groups: Group[] = []
    mergeIntoV3Group(groups, ['https://example.com/*'], ['b.png', 'a.png'])

    expect(groups).toEqual([
      // resources are de-duped and sorted
      {resources: ['a.png', 'b.png'], matches: ['https://example.com/*']}
    ])
  })

  it('merges into an existing group with the same match set (order-insensitive)', () => {
    const groups: Group[] = [
      {resources: ['a.png'], matches: ['https://b.com/*', 'https://a.com/*']}
    ]
    // Same matches, different declared order -> same group
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

    // assets/logo.png is covered by assets/* and must not be added again
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
})

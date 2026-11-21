import {describe, expect, it} from 'vitest'
import {asCompilation} from '../../__spec__/helpers/rspack-fakes'
import {
  isCriticalJsonFeature,
  re2UnsupportedConstruct,
  validateJsonAsset
} from '../json-validation'

function makeCompilation() {
  return {
    errors: [] as Array<Error & {file?: string}>,
    warnings: [] as Array<Error & {file?: string}>
  }
}

function validateRuleset(json: string, browser?: string) {
  const compilation = makeCompilation()
  const ok = validateJsonAsset(
    asCompilation(compilation),
    'declarative_net_request.ruleset',
    '/abs/rules.json',
    Buffer.from(json),
    browser
  )

  return {ok, compilation}
}

const validRule = {
  id: 1,
  priority: 1,
  action: {type: 'block'},
  condition: {urlFilter: 'ads'}
}

describe('isCriticalJsonFeature', () => {
  it('treats both storage schema key spellings as critical', () => {
    expect(isCriticalJsonFeature('storage.managed_schema')).toBe(true)
    expect(isCriticalJsonFeature('storage/managed_schema')).toBe(true)
    expect(isCriticalJsonFeature('declarative_net_request/block')).toBe(true)
    expect(isCriticalJsonFeature('side_panel.default_path')).toBe(false)
  })
})

describe('validateJsonAsset DNR per-rule validation', () => {
  it('accepts a well-formed ruleset', () => {
    const {ok, compilation} = validateRuleset(JSON.stringify([validRule]))
    expect(ok).toBe(true)
    expect(compilation.errors).toHaveLength(0)
    expect(compilation.warnings).toHaveLength(0)
  })

  it('accepts an empty ruleset array', () => {
    const {ok, compilation} = validateRuleset('[]')
    expect(ok).toBe(true)
    expect(compilation.errors).toHaveLength(0)
  })

  it('rejects a rule whose id is not a positive integer', () => {
    for (const id of [0, -1, 1.5, '1', undefined]) {
      const {ok, compilation} = validateRuleset(
        JSON.stringify([{...validRule, id}])
      )
      expect(ok).toBe(false)
      expect(compilation.errors).toHaveLength(1)
      expect(compilation.errors[0].name).toBe('DNRInvalidRule')
      expect(compilation.errors[0].message).toContain('index 0')
      expect(compilation.errors[0].message).toContain('positive integer')
    }
  })

  it('rejects a rule without an action type', () => {
    const missingAction = {id: 1, condition: {urlFilter: 'x'}}
    const typelessAction = {...validRule, action: {}}
    const nonStringType = {...validRule, action: {type: 7}}

    for (const rule of [missingAction, typelessAction, nonStringType]) {
      const {ok, compilation} = validateRuleset(JSON.stringify([rule]))
      expect(ok).toBe(false)
      expect(compilation.errors).toHaveLength(1)
      expect(compilation.errors[0].name).toBe('DNRInvalidRule')
    }
  })

  it('rejects a rule without a condition object', () => {
    const missingCondition = {id: 1, action: {type: 'block'}}
    const arrayCondition = {...validRule, condition: []}

    for (const rule of [missingCondition, arrayCondition]) {
      const {ok, compilation} = validateRuleset(JSON.stringify([rule]))
      expect(ok).toBe(false)
      expect(compilation.errors[0].message).toContain('condition')
    }
  })

  it('rejects non-object rule entries and names the offending index', () => {
    const {ok, compilation} = validateRuleset(
      JSON.stringify([validRule, 'not-a-rule'])
    )
    expect(ok).toBe(false)
    expect(compilation.errors).toHaveLength(1)
    expect(compilation.errors[0].message).toContain('index 1')
    expect(compilation.errors[0].message).toContain('not an object')
  })

  it('warns without failing on a malformed priority', () => {
    const {ok, compilation} = validateRuleset(
      JSON.stringify([{...validRule, priority: '1'}])
    )
    expect(ok).toBe(true)
    expect(compilation.errors).toHaveLength(0)
    expect(compilation.warnings).toHaveLength(1)
    expect(compilation.warnings[0].name).toBe('DNRRuleShapeIssue')
    expect(compilation.warnings[0].message).toContain('priority')
  })

  it('accepts a rule with no priority at all, as Chrome defaults it', () => {
    const {id, action, condition} = validRule
    const {ok, compilation} = validateRuleset(
      JSON.stringify([{id, action, condition}])
    )
    expect(ok).toBe(true)
    expect(compilation.warnings).toHaveLength(0)
  })
})

describe('re2UnsupportedConstruct', () => {
  it('names a lookahead, a lookbehind and a backreference', () => {
    expect(re2UnsupportedConstruct('odd-(?=rule)')).toBe('a lookahead')
    expect(re2UnsupportedConstruct('odd-(?!x)rule')).toBe('a lookahead')
    expect(re2UnsupportedConstruct('(?<=odd-)rule')).toBe('a lookbehind')
    expect(re2UnsupportedConstruct('(?<!x)odd-rule')).toBe('a lookbehind')
    expect(re2UnsupportedConstruct('(o)dd-rule\\1')).toBe('a backreference')
  })

  it('passes what RE2 compiles', () => {
    for (const filter of [
      'odd-(?:rule|x)[(?=]?',
      '^https?://(www\\.)?example\\.com/',
      '(?i)ads',
      '(?P<name>a)b',
      '\\(\\?=x\\)',
      'a\\\\1',
      '[\\1]',
      'page\\d+\\0'
    ]) {
      expect(re2UnsupportedConstruct(filter)).toBeUndefined()
    }
  })
})

describe('validateJsonAsset on what only Chrome refuses', () => {
  const regexRule = (id: number, regexFilter: string) => ({
    ...validRule,
    id,
    condition: {regexFilter}
  })

  it('warns a chromium build about a repeated rule id and keeps building', () => {
    const rules = JSON.stringify([
      validRule,
      {...validRule, id: 3},
      {...validRule, id: 3},
      {...validRule, id: 3}
    ])

    for (const browser of ['chrome', 'edge', 'chromium-based']) {
      const {ok, compilation} = validateRuleset(rules, browser)
      expect(ok).toBe(true)
      expect(compilation.errors).toHaveLength(0)
      expect(compilation.warnings).toHaveLength(1)
      expect(compilation.warnings[0].name).toBe('DNRDuplicateRuleId')
      expect(compilation.warnings[0].file).toBe('/abs/rules.json')
      expect(compilation.warnings[0].message).toContain('id 3')
      expect(compilation.warnings[0].message).toContain(
        'Chrome refuses to load'
      )
    }
  })

  it('warns a chromium build about a filter RE2 cannot compile, once per construct', () => {
    const {ok, compilation} = validateRuleset(
      JSON.stringify([
        validRule,
        regexRule(2, 'odd-(?=rule)'),
        regexRule(3, 'odd-(?!x)rule'),
        regexRule(4, '(o)dd\\1'),
        regexRule(5, 'odd-(?:rule|x)')
      ]),
      'chrome'
    )
    expect(ok).toBe(true)
    expect(compilation.errors).toHaveLength(0)
    expect(compilation.warnings.map((w: Error) => w.name)).toEqual([
      'DNRRegexChromeCannotCompile',
      'DNRRegexChromeCannotCompile'
    ])

    expect(compilation.warnings[0].message).toContain('id 2, 3')
    expect(compilation.warnings[0].message).toContain('a lookahead')
    expect(compilation.warnings[1].message).toContain('id 4')
    expect(compilation.warnings[1].message).toContain('a backreference')
  })

  it('says nothing to firefox, safari or a build with no target', () => {
    const rules = JSON.stringify([
      {...validRule, id: 3},
      {...validRule, id: 3},
      regexRule(4, 'odd-(?=rule)')
    ])

    for (const browser of ['firefox', 'gecko-based', 'safari', undefined]) {
      const {ok, compilation} = validateRuleset(rules, browser)
      expect(ok).toBe(true)
      expect(compilation.warnings).toHaveLength(0)
    }
  })

  it('says nothing about a rule Chrome loads and skips', () => {
    const {ok, compilation} = validateRuleset(
      JSON.stringify([
        validRule,
        {...validRule, id: 2, action: {type: 'frobnicate'}},
        {
          ...validRule,
          id: 3,
          condition: {urlFilter: 'x', resourceTypes: ['future_type']}
        },
        {...validRule, id: 4, condition: {urlFilter: 'x', futureKey: ['y']}}
      ]),
      'chrome'
    )
    expect(ok).toBe(true)
    expect(compilation.warnings).toHaveLength(0)
  })
})

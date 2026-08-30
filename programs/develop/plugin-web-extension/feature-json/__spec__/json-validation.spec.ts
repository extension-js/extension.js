import {describe, expect, it} from 'vitest'
import {isCriticalJsonFeature, validateJsonAsset} from '../json-validation'

function makeCompilation() {
  return {
    errors: [] as Array<Error & {file?: string}>,
    warnings: [] as Array<Error & {file?: string}>
  } as any
}

function validateRuleset(json: string) {
  const compilation = makeCompilation()
  const ok = validateJsonAsset(
    compilation,
    'declarative_net_request.ruleset',
    '/abs/rules.json',
    Buffer.from(json)
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

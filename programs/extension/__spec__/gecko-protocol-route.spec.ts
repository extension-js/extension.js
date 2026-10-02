import {describe, expect, it} from 'vitest'
import {bridgeBlamedTheExtensionCsp, bridgeHadNoExecutor} from '../commands/act'

const refusal = (error: Record<string, unknown>) => ({ok: false, error})

describe('which bridge refusals are worth retrying over the protocol', () => {
  it('takes the route when the document CSP blocked eval', () => {
    const result = refusal({
      name: 'EvalError',
      message: 'call to eval() blocked by CSP'
    })

    expect(bridgeBlamedTheExtensionCsp(result)).toBe(true)
    expect(bridgeHadNoExecutor(result)).toBe(false)
  })

  it('takes the route when no executor is connected at all', () => {
    const result = refusal({
      name: 'Unavailable',
      message: 'control channel not available'
    })

    expect(bridgeHadNoExecutor(result)).toBe(true)
    expect(bridgeBlamedTheExtensionCsp(result)).toBe(false)
  })

  it('takes the route when the bridge found no target to evaluate in', () => {
    expect(
      bridgeHadNoExecutor(
        refusal({name: 'TargetNotFound', message: 'no such target'})
      )
    ).toBe(true)
  })

  it('leaves a refusal the protocol cannot help with alone', () => {
    for (const error of [
      {name: 'EvalDisabled', message: 'eval is not enabled for this session'},
      {name: 'EvalTokenMissing', message: 'token missing'},
      {name: 'Timeout', message: 'timed out'},
      {name: 'BadRequest', message: 'bad expression'},
      {name: 'EvalError', message: 'ReferenceError: nope is not defined'}
    ]) {
      const result = refusal(error)

      expect(bridgeBlamedTheExtensionCsp(result)).toBe(false)
      expect(bridgeHadNoExecutor(result)).toBe(false)
    }
  })

  it('reads a tagged refusal code over the error name', () => {
    expect(
      bridgeBlamedTheExtensionCsp(
        refusal({name: 'Error', message: 'whatever', code: 'csp_blocks_eval'})
      )
    ).toBe(true)
  })
})

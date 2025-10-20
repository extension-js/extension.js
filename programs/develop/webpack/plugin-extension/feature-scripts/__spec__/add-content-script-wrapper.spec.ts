import {describe, expect, it} from 'vitest'
import {AddContentScriptWrapper} from '../steps/setup-reload-strategy/add-content-script-wrapper'

function createCompiler() {
  return {
    options: {
      mode: 'development',
      module: {rules: []}
    }
  } as any
}

describe('AddContentScriptWrapper', () => {
  it('pushes three loader rules with proper includes/excludes', () => {
    const compiler = createCompiler()
    const plugin = new AddContentScriptWrapper({
      manifestPath: '/abs/manifest.json'
    } as any)
    plugin.apply(compiler)
    expect(compiler.options.module.rules.length).toBe(3)
  })
})

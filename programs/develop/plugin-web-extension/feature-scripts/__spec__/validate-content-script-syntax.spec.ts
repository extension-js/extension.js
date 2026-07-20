import {describe, expect, it} from 'vitest'
import {ValidateContentScriptSyntax} from '../steps/validate-content-script-syntax'

function makeCompilation(assets: Record<string, string>) {
  const compilation: any = {
    errors: [],
    getAssets: () =>
      Object.entries(assets).map(([name, src]) => ({
        name,
        source: {source: () => src}
      })),
    hooks: {
      processAssets: {tap: (_opts: any, fn: any) => fn()}
    }
  }
  const compiler: any = {
    hooks: {
      thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
    }
  }
  return {compiler, compilation}
}

describe('ValidateContentScriptSyntax', () => {
  it('fails the compile when an emitted content script is unparsable', () => {
    const {compiler, compilation} = makeCompilation({
      'content_scripts/content-0.abc123.js':
        'let panel = null;\nconst {panel: p, panel} = {};\n'
    })
    new ValidateContentScriptSyntax().apply(compiler)
    expect(compilation.errors).toHaveLength(1)
    expect(String(compilation.errors[0].message)).toContain(
      'not valid JavaScript'
    )
    expect(compilation.errors[0].file).toBe(
      'content_scripts/content-0.abc123.js'
    )
  })

  it('accepts parsable content scripts and ignores non-content assets', () => {
    const {compiler, compilation} = makeCompilation({
      'content_scripts/content-0.js': 'console.log("fine");',
      'content_scripts/content-1.css': 'body{color:red}',
      'background/service_worker.js': 'let x = 1; const {x: y, x: z} = {};'
    })
    new ValidateContentScriptSyntax().apply(compiler)
    expect(compilation.errors).toHaveLength(0)
  })
})

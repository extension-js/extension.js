import {describe, expect, it} from 'vitest'
import {ValidateEmittedScriptSyntax} from '../steps/validate-emitted-script-syntax'

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

describe('ValidateEmittedScriptSyntax', () => {
  it('fails the compile when an emitted content script is unparsable', () => {
    const {compiler, compilation} = makeCompilation({
      'content_scripts/content-0.abc123.js':
        'let panel = null;\nconst {panel: p, panel} = {};\n'
    })
    new ValidateEmittedScriptSyntax().apply(compiler)
    expect(compilation.errors).toHaveLength(1)
    expect(String(compilation.errors[0].message)).toContain(
      'not valid JavaScript'
    )
    expect(String(compilation.errors[0].message)).toContain(
      'silently skip an unparsable content script'
    )
    expect(compilation.errors[0].file).toBe(
      'content_scripts/content-0.abc123.js'
    )
  })

  // Regression: the check was scoped to content_scripts, so an action page and
  // a service worker could ship a file the engine refuses to parse while the
  // build printed nothing and exited 0.
  it('fails the compile for any other emitted script, not just content scripts', () => {
    const {compiler, compilation} = makeCompilation({
      'action/index.js': 'let a = JSON.parse("{}");\nlet a = JSON.parse("[]");',
      'background/service_worker.js': 'let i = 1;\nlet i = 2;'
    })
    new ValidateEmittedScriptSyntax().apply(compiler)

    expect(compilation.errors).toHaveLength(2)
    const files = compilation.errors.map((error: any) => error.file).sort()
    expect(files).toEqual(['action/index.js', 'background/service_worker.js'])
    expect(String(compilation.errors[0].message)).toContain('dead on arrival')
  })

  it('accepts parsable scripts and ignores non-script assets', () => {
    const {compiler, compilation} = makeCompilation({
      'content_scripts/content-0.js': 'console.log("fine");',
      'content_scripts/content-1.css': 'body{color:red}',
      'action/index.js': 'const x = 1; console.log(x);',
      'manifest.json': '{"broken": '
    })
    new ValidateEmittedScriptSyntax().apply(compiler)
    expect(compilation.errors).toHaveLength(0)
  })

  // An ES module output is legal and would fail a script-mode parse on its
  // first `import`, so the module parse has to get the last word.
  it('accepts an emitted ES module', () => {
    const {compiler, compilation} = makeCompilation({
      'background/service_worker.js':
        'import {a} from "./a.js";\nexport const b = a;\nawait Promise.resolve();\n',
      'pages/newtab.mjs': 'export default import.meta.url;\n'
    })
    new ValidateEmittedScriptSyntax().apply(compiler)
    expect(compilation.errors).toHaveLength(0)
  })
})

import {describe, expect, it} from 'vitest'
import {
  blankComments,
  findUnplacedStyleImports,
  namesShadowHost
} from '../../css-lib/unplaced-style-imports'

describe('findUnplacedStyleImports', () => {
  it('finds a sheet imported for its side effect, with its line', () => {
    const source = [
      "import {mount} from './mount'",
      "import './styles.css'",
      'import "./theme.scss";',
      "import './legacy.sass'",
      "import './vars.less'",
      'mount()'
    ].join('\n')

    expect(findUnplacedStyleImports(source)).toEqual([
      {request: './styles.css', line: 2},
      {request: './theme.scss', line: 3},
      {request: './legacy.sass', line: 4},
      {request: './vars.less', line: 5}
    ])
  })

  it('finds a package sheet and an import that follows a statement', () => {
    const source = "const a = 1;import 'some-kit/dist/kit.css'\n"

    expect(findUnplacedStyleImports(source)).toEqual([
      {request: 'some-kit/dist/kit.css', line: 1}
    ])
  })

  it('leaves an import that binds the value alone', () => {
    const source = [
      "import href from './styles.css'",
      "import * as sheet from './theme.scss'",
      "import {primary} from './tokens.css'",
      'console.log(href, sheet, primary)'
    ].join('\n')

    expect(findUnplacedStyleImports(source)).toEqual([])
  })

  it('leaves a CSS module and a queried request alone', () => {
    const source = [
      "import './styles.module.css'",
      "import './theme.module.scss'",
      "import './styles.css?url'",
      "import './styles.css?raw'",
      "import './styles.css?inline'"
    ].join('\n')

    expect(findUnplacedStyleImports(source)).toEqual([])
  })

  it('leaves a sheet the same file reads through new URL() alone', () => {
    const source = [
      "import './styles.css'",
      'async function fetchCSS() {',
      "  const cssUrl = new URL('./styles.css', import.meta.url)",
      '  return (await fetch(cssUrl)).text()',
      '}'
    ].join('\n')

    expect(findUnplacedStyleImports(source)).toEqual([])
  })

  it('leaves a sheet the same file also requires or imports by value alone', () => {
    expect(
      findUnplacedStyleImports(
        'import \'./a.css\'\nconst href = require("./a.css")\n'
      )
    ).toEqual([])

    expect(
      findUnplacedStyleImports("import './a.css'\nimport href from './a.css'\n")
    ).toEqual([])
  })

  it('still reports a sheet that is only named again inside a comment', () => {
    const source = [
      "import './styles.css'",
      "// const url = new URL('./styles.css', import.meta.url)",
      "/* import href from './styles.css' */"
    ].join('\n')

    expect(findUnplacedStyleImports(source)).toEqual([
      {request: './styles.css', line: 1}
    ])
  })

  it('ignores an import written inside a comment', () => {
    const source = [
      "// import './styles.css'",
      '/*',
      "import './theme.css'",
      '*/',
      "const note = 'see https://example.com/a.css'"
    ].join('\n')

    expect(findUnplacedStyleImports(source)).toEqual([])
  })

  it('reports a sheet imported twice once', () => {
    expect(
      findUnplacedStyleImports("import './a.css'\nimport './a.css'\n")
    ).toEqual([{request: './a.css', line: 1}])
  })

  it('ignores scripts, data files and a source with no import', () => {
    expect(
      findUnplacedStyleImports("import './setup.js'\nimport './data.json'\n")
    ).toEqual([])

    expect(findUnplacedStyleImports('console.log("./styles.css")')).toEqual([])
  })
})

describe('blankComments', () => {
  it('keeps every offset and line, and a // inside a string', () => {
    const source = "const a = 'http://x' // note\n/* b\n c */ const d = 1\n"
    const blanked = blankComments(source)

    expect(blanked).toHaveLength(source.length)
    expect(blanked.split('\n')).toHaveLength(source.split('\n').length)
    expect(blanked).toContain("'http://x'")
    expect(blanked).not.toContain('note')
    expect(blanked).toContain('const d = 1')
  })
})

describe('namesShadowHost', () => {
  it('reads the attribute and the id the build looks for', () => {
    expect(
      namesShadowHost("root.setAttribute('data-extension-root', 'true')")
    ).toBe(true)

    expect(namesShadowHost("root.id = 'extension-root'")).toBe(true)
    expect(namesShadowHost("root.id = 'app-root'")).toBe(false)
  })
})

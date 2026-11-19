import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {
  classicConcatEntry,
  classicConcatFiles,
  classicConcatRequest,
  isClassicScript
} from '../classic-concat'

const makeTempFolder = trackTempFolders()

function classic(source: string, name = 'script.js'): boolean {
  const file = path.join(makeTempFolder('extjs-classic-'), name)
  fs.writeFileSync(file, source)

  return isClassicScript(file)
}

describe('isClassicScript', () => {
  it('calls a file with no import or export classic', () => {
    expect(classic('var shared = 1\nfunction boot() {}\n')).toBe(true)
    expect(classic('const a: string = "x"\n', 'script.ts')).toBe(true)
    expect(classic('console.log(import.meta.url)\n')).toBe(true)
  })

  it('calls a file with a static import or an export a module', () => {
    expect(classic('import a from "./a.js"\n')).toBe(false)
    expect(classic('  import"./a.js"\n')).toBe(false)
    expect(classic('import {a} from "./a.js"\n')).toBe(false)
    expect(classic('import * as a from "./a.js"\n')).toBe(false)
    expect(classic('var a = 1\nexport default a\n')).toBe(false)
    expect(classic('var a = 1\nexport {a}\n')).toBe(false)
  })

  it('calls a file it cannot read a module', () => {
    expect(
      isClassicScript(path.join(makeTempFolder('extjs-classic-'), 'no.js'))
    ).toBe(false)
  })

  it('calls a file whose only import is import() classic', () => {
    expect(classic('var ready = 1\nimport("./lazy.js")\n')).toBe(true)
    expect(classic('import ("./lazy.js").then(() => {})\n')).toBe(true)
  })

  it('ignores an import or export line inside a comment or a string', () => {
    expect(classic('/*\nimport a from "./a.js"\n*/\nvar a = 1\n')).toBe(true)
    expect(classic('var text = `\nexport default 1\n`\n')).toBe(true)
  })

  it('still reads a re-export as a module', () => {
    expect(classic('export * from "./a.js"\n')).toBe(false)
  })

  it('tells JSX apart line by line, where the lexer cannot parse', () => {
    const view = 'var view = <div className="x">hello</div>\n'

    expect(classic(view, 'view.jsx')).toBe(true)
    expect(classic(`import("./lazy.js")\n${view}`, 'view.jsx')).toBe(true)
    expect(classic(`import a from "./a.js"\n${view}`, 'view.jsx')).toBe(false)
    expect(classic(`${view}export default view\n`, 'view.jsx')).toBe(false)
  })
})

describe('classicConcatRequest', () => {
  function joined(present: string[]) {
    const folder = makeTempFolder('extjs-classic-')
    const files = ['a.js', 'b.js', 'c.js'].map((name) =>
      path.join(folder, name)
    )

    for (const file of files) {
      if (present.includes(path.basename(file))) fs.writeFileSync(file, '')
    }

    const entry = classicConcatEntry('content_scripts/content-0', files)

    return {files, entry, query: entry.slice(files[0].length)}
  }

  it('keeps the request as written while the first file exists', () => {
    const {entry} = joined(['a.js', 'c.js'])

    expect(classicConcatRequest(entry)).toBe(entry)
    expect(classicConcatRequest(entry, 'loader.cjs')).toBe(entry)
  })

  it('moves to the first file left when the first one is gone', () => {
    const {files, entry, query} = joined(['c.js'])
    const moved = classicConcatRequest(entry, 'loader.cjs')

    expect(moved).toBe(`${files[2]}${query}`)
    expect(classicConcatFiles(moved)).toEqual(files)
  })

  it('hands the query to the loader when no file is left', () => {
    const {files, entry, query} = joined([])
    const moved = classicConcatRequest(entry, 'loader.cjs')

    expect(moved).toBe(`!!loader.cjs!loader.cjs${query}`)
    expect(classicConcatFiles(moved)).toEqual(files)
    expect(classicConcatRequest(entry)).toBe(entry)
  })

  it('leaves any other request alone', () => {
    const missing = path.join(makeTempFolder('extjs-classic-'), 'no.js')

    expect(classicConcatRequest(missing)).toBe(missing)
    expect(classicConcatRequest(`${missing}?raw`)).toBe(`${missing}?raw`)
    expect(classicConcatRequest('./relative.js')).toBe('./relative.js')
  })
})

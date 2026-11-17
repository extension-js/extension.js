import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {trackTempFolders} from '../../../__spec__/helpers/temp-folders'
import {isClassicScript} from '../classic-concat'

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

  // Pins today's behavior. Ledger 1401 D8.
  it('calls a classic file a module when a line starts with import(', () => {
    expect(classic('var ready = 1\nimport("./lazy.js")\n')).toBe(false)
    expect(classic('import ("./lazy.js").then(() => {})\n')).toBe(false)
  })

  // Pins today's behavior. Ledger 1401 D8.
  it('calls a classic file a module when a comment or string holds an import line', () => {
    expect(classic('/*\nimport a from "./a.js"\n*/\nvar a = 1\n')).toBe(false)
    expect(classic('var text = `\nexport default 1\n`\n')).toBe(false)
  })
})

import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

// The control bridge carries frames. What a background runs for a reload
// lives in plugin-reload and is handed to the producer by its caller.
const FOLDER = path.resolve(__dirname, '..')

const files = fs
  .readdirSync(FOLDER)
  .filter((name) => name.endsWith('.ts'))
  .map((file) => ({
    file,
    text: fs.readFileSync(path.join(FOLDER, file), 'utf8')
  }))

describe('what the control bridge holds', () => {
  it('reads its own source files', () => {
    expect(files.map(({file}) => file)).toContain('producer-runtime.ts')
  })

  it('imports nothing from plugin-reload or plugin-browsers', () => {
    expect(
      files
        .filter(({text}) =>
          /from\s+'[^']*(?:plugin-reload|plugin-browsers)[^']*'/.test(text)
        )
        .map(({file}) => file)
    ).toEqual([])
  })

  it('defines no reload executor of its own', () => {
    const executor =
      /function\s+(?:handleDevReloadFrame|performDevReload|reinjectContentScripts|healOpenTabsAtBoot|restartExtension|refreshDeclaredSheets|refreshRegisteredScripts|watchBootRegistrations)\b/

    expect(
      files.filter(({text}) => executor.test(text)).map(({file}) => file)
    ).toEqual([])
  })
})

import {describe, expect, it} from 'vitest'
import {formatPrettyLogLine} from '../commands/logs'

// The escape character and the color sequence it opens, on a color terminal.
const COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

const line = (event: Parameters<typeof formatPrettyLogLine>[0]) =>
  formatPrettyLogLine(event).replace(COLOR, '')

describe('a coded line in extension logs', () => {
  it('prints the code once when the text already opens with it', () => {
    expect(
      line({
        seq: 7,
        level: 'warn',
        context: 'background',
        code: 'W_RELOAD_NOT_APPLIED',
        messageParts: [
          'Extension.js W_RELOAD_NOT_APPLIED: the extension could not be reloaded.',
          'Error: gone'
        ]
      })
    ).toBe(
      '[7] WARN (background) Extension.js W_RELOAD_NOT_APPLIED: the extension could not be reloaded. Error: gone'
    )
  })

  it('prints the code before a text that does not name it', () => {
    expect(
      line({
        seq: 8,
        level: 'error',
        context: 'content',
        code: 'E_X',
        messageParts: ['broken']
      })
    ).toBe('[8] ERROR (content) E_X broken')
  })
})

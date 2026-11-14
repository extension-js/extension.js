import {afterEach, describe, expect, it} from 'vitest'
import {
  blankComments,
  forgetBlankedSources,
  keptBlankedSources,
  skipString
} from '../steps/source-literals'

// The answer one append per character gives, kept here as the reference the
// faster walk has to match on every input.
function blankedByCharacter(source: string): string {
  let out = ''
  let i = 0
  const n = source.length

  while (i < n) {
    const char = source[i]
    const next = source[i + 1]

    if (char === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' '
        i++
      }

      continue
    }

    if (char === '/' && next === '*') {
      out += '  '
      i += 2

      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }

      if (i < n) {
        out += '  '
        i += 2
      }

      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      const end = skipString(source, i, n)
      out += source.slice(i, Math.min(end + 1, n))
      i = end + 1
      continue
    }

    out += char
    i++
  }

  return out
}

// A fixed sequence, so a failure names an input that can be run again.
function sequence(seed: number) {
  let state = seed

  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff

    return state
  }
}

const PIECES = [
  '//',
  '/*',
  '*/',
  '/',
  '*',
  '"',
  "'",
  '`',
  '${',
  '}',
  '\\',
  '\n',
  ' ',
  'a',
  'fetch("x.json")',
  'chrome.runtime.getURL(',
  ')',
  '{',
  ';'
]

afterEach(() => {
  forgetBlankedSources()
})

describe('blankComments', () => {
  it('blanks comments, keeps strings and keeps every offset', () => {
    const source = [
      'a() // fetch("gone.json")',
      'b("// kept") /* fetch("gone.json")',
      'still gone */ c(`/* kept ${d("*/")} */`)',
      "e('it\\'s // kept')"
    ].join('\n')
    const blanked = blankComments(source)

    expect(blanked).toHaveLength(source.length)
    expect(blanked).not.toContain('gone.json')
    expect(blanked).toContain('b("// kept")')
    expect(blanked).toContain('c(`/* kept ${d("*/")} */`)')
    expect(blanked).toContain("e('it\\'s // kept')")
    expect(blanked.split('\n')).toHaveLength(4)
  })

  it('matches the per-character answer on edge and generated inputs', () => {
    const inputs = [
      '',
      '/',
      '//',
      '/*',
      '/**/',
      '/* open',
      '"open',
      '`open ${',
      'a/',
      'a//b\n/*c*/d',
      'no comment at all'
    ]

    for (let seed = 1; seed <= 400; seed++) {
      const next = sequence(seed)
      const length = 1 + (next() % 40)
      let text = ''

      for (let i = 0; i < length; i++) text += PIECES[next() % PIECES.length]

      inputs.push(text)
    }

    for (const input of inputs) {
      expect(blankComments(input), JSON.stringify(input)).toBe(
        blankedByCharacter(input)
      )
    }
  })

  it('hands back the same text when there is nothing to blank', () => {
    const source = 'const a = "http://x"; call(a)'

    expect(blankComments(source)).toBe(source)
  })

  it('keeps the answer for a large text until the scans are over', () => {
    const large = `${'call("a") /* note */ ; '.repeat(4096)}// end`
    const first = blankComments(large)

    expect(first).toBe(blankedByCharacter(large))
    expect(keptBlankedSources()).toBe(1)

    // A second copy of the text, as a second read of the asset hands over.
    expect(blankComments(`${large.slice(0, 10)}${large.slice(10)}`)).toBe(first)
    expect(keptBlankedSources()).toBe(1)

    // A call's argument text is small and read once, so it is not kept.
    blankComments('fetch("x.json") // small')
    expect(keptBlankedSources()).toBe(1)

    forgetBlankedSources()
    expect(keptBlankedSources()).toBe(0)
  })

  it('never holds more than a bounded number of texts', () => {
    for (let i = 0; i < 100; i++) {
      blankComments(`${String(i)} ${'x /* y */ '.repeat(8192)}`)
    }

    expect(keptBlankedSources()).toBeLessThanOrEqual(32)
  })
})

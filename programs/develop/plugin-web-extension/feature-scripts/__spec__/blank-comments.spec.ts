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

    const close = char === '/' ? patternEnd(source, i) : -1

    if (close !== -1) {
      out += '/'

      for (let j = i + 1; j < close; j++) {
        out += '\'"`()[]{}'.includes(source[j]) ? ' ' : source[j]
      }

      out += '/'
      i = close + 1
      continue
    }

    out += char
    i++
  }

  return out
}

// Where the regular expression opened at this slash closes, or -1 when the
// slash divides. Written apart from the walk it checks, one rule at a time.
function patternEnd(source: string, open: number): number {
  const before = source.slice(0, open).trimEnd()
  const last = before.at(-1)

  if (last !== undefined) {
    const word = /[\w$]+$/.exec(before)?.[0]
    const afterWord =
      word !== undefined &&
      /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(
        word
      )

    if (word !== undefined && !afterWord) return -1
    if (word === undefined && /[)\]}'"`<.]$/.test(before)) return -1
    if (/(?:\+\+|--)$/.test(before)) return -1
  }

  let inClass = false

  for (let i = open + 1; i < source.length; i++) {
    const char = source[i]

    if (char === '\n' || char === '\r') return -1

    if (char === '\\') i++
    else if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) return i
  }

  return -1
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

  it('reads on past a regular expression that ends in two slashes', () => {
    // One line, as a minifier writes it: a comment read here would blank
    // every call after the pattern.
    const source =
      'let c=/\\/\\*[\\s\\S]*?\\*\\//g;x.replace(c,"");fetch("kept.json")'
    const blanked = blankComments(source)

    expect(blanked).toHaveLength(source.length)
    expect(blanked).toContain('fetch("kept.json")')
  })

  it('keeps a quote or a bracket inside a pattern from opening anything', () => {
    const source = 'a=e.split(/["\'(]/);b=x.test(/`/)?1:2;fetch("kept.json")'
    const blanked = blankComments(source)

    expect(blanked).toHaveLength(source.length)
    expect(blanked).toContain('a=e.split(/     /)')
    expect(blanked).toContain('x.test(/ /)')
    expect(blanked).toContain('fetch("kept.json")')
  })

  it('steps over a pattern holding a quote inside an interpolation', () => {
    // The quote once opened a string that ran to the next one, and the
    // address after it was blanked as a comment to the end of the line.
    const source =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text
      'a=`"${t.replace(/"/g,"x")}"`;b=`https://example.com/${c}`;fetch("kept.json")'

    expect(blankComments(source)).toBe(source)
  })

  it('reads a slash after a value as division', () => {
    const source = 'a = b / 2 // fetch("gone.json")\nc = (d) / e /* gone */ / f'
    const blanked = blankComments(source)

    expect(blanked).not.toContain('gone')
    expect(blanked).toContain('a = b / 2 ')
    expect(blanked.split('\n')[1].replace(/ +/g, ' ')).toBe('c = (d) / e / f')
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

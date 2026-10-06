export interface Scan {
  code: string
  lineOf: (index: number) => number
}

function startsRegex(source: string, slash: number): boolean {
  let k = slash - 1
  while (k >= 0 && (source[k] === ' ' || source[k] === '\t')) k--
  if (k < 0) return true

  const prev = source[k]
  if ('(,=:[!&|?{};\n'.includes(prev)) return true

  return /\breturn$/.test(source.slice(Math.max(0, k - 6), k + 1))
}

export function blankOutLiterals(source: string): Scan {
  const out = source.split('')
  let i = 0
  const templateDepth: number[] = []

  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }

  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end < 0 ? source.length : end
      blank(i, stop)
      i = stop
      continue
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end < 0 ? source.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }

    if (ch === '/' && startsRegex(source, i)) {
      let j = i + 1
      let inClass = false

      while (j < source.length && source[j] !== '\n') {
        if (source[j] === '\\') {
          j += 2
          continue
        }

        if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        else if (source[j] === '/' && !inClass) break

        j++
      }

      blank(i + 1, j)
      i = j + 1
      continue
    }

    if (ch === "'" || ch === '"') {
      let j = i + 1

      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        if (source[j] === '\\') j++

        j++
      }

      blank(i + 1, j)
      i = j + 1
      continue
    }

    if (ch === '`') {
      let j = i + 1

      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2
          continue
        }

        if (source[j] === '`') break

        if (source[j] === '$' && source[j + 1] === '{') {
          templateDepth.push(1)
          j += 2

          while (j < source.length && templateDepth.length > 0) {
            if (source[j] === '{') templateDepth[templateDepth.length - 1]++
            if (source[j] === '}') templateDepth[templateDepth.length - 1]--

            if (templateDepth[templateDepth.length - 1] === 0) {
              templateDepth.pop()
              break
            }

            j++
          }
        }

        j++
      }

      blank(i + 1, j)
      i = j + 1
      continue
    }

    i++
  }

  const code = out.join('')
  const lineStarts = [0]

  for (let k = 0; k < source.length; k++) {
    if (source[k] === '\n') lineStarts.push(k + 1)
  }

  return {
    code,
    lineOf: (index) => {
      let lo = 0
      let hi = lineStarts.length - 1

      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (lineStarts[mid] <= index) lo = mid
        else hi = mid - 1
      }

      return lo + 1
    }
  }
}

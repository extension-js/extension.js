import {normalizeLiteralPayload} from './context'

export function cleanupPublicRootLiterals(input: string): string {
  input = input.replace(
    /(['"])\/public\/([^'"]+?)\1/g,
    function onMatch(_m: string, q: string, p: string) {
      return `${q}${normalizeLiteralPayload(p)}${q}`
    }
  )
  input = input.replace(
    /(['"])public\/(.*?)\1/g,
    function onMatch(_m: string, q: string, p: string) {
      return `${q}${normalizeLiteralPayload(p)}${q}`
    }
  )
  return input
}

export function normalizeSpecialFolderExtensions(input: string): string {
  input = input.replace(
    /(['"])((?:pages|scripts)\/[^'"]+?)\.(ts|tsx)\1/g,
    function onMatch(_m: string, q: string, p: string) {
      return `${q}${p}.js${q}`
    }
  )
  input = input.replace(
    /(['"])((?:pages|scripts)\/[^'"]+?)\.(njk|nunjucks)\1/g,
    function onMatch(_m: string, q: string, p: string) {
      return `${q}${p}.html${q}`
    }
  )
  input = input.replace(
    /(['"])((?:pages|scripts)\/[^'"]+?)\.(scss|sass|less)\1/g,
    function onMatch(_m: string, q: string, p: string) {
      return `${q}${p}.css${q}`
    }
  )
  return input
}

export function collapseAccidentalDoubleQuotes(
  input: string,
  keys: string[]
): string {
  const keyUnion = `(?:${keys.join('|')})`
  input = input.replace(new RegExp(`(${keyUnion}\\s*:\\s*)''`, 'g'), `$1'`)
  input = input.replace(new RegExp(`(${keyUnion}\\s*:\\s*)""`, 'g'), `$1"`)
  input = input.replace(/:\s*''/g, ": '")
  input = input.replace(/:\s*""/g, ': "')
  input = input.replace(/:\s*''([^']+)'/g, ": '$1'")
  input = input.replace(/:\s*\"\"([^\"]+)\"/g, ': "$1"')
  input = input.replace(/''([^']*?)''/g, "'$1'")
  input = input.replace(/""([^"]*?)""/g, '"$1"')
  return input
}

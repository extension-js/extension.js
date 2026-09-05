import assert from 'node:assert/strict'
import {execSync} from 'node:child_process'
import fs from 'node:fs'
import {test} from 'node:test'
import {
  EXTRA_PROSE_SOURCES,
  findAsciiEllipsis,
  findBrandInMarkdown,
  findBrandInSource,
  findBrightBlueMisuse,
  findEmoji,
  findExclamations,
  findForbiddenWords,
  findInvalidOpeners,
  findNonImperative,
  findRetiredPrefixes,
  findSemicolons,
  findUnderlinePeriods,
  findWeakVerbs,
  functionAt,
  lineAt,
  lineHeads,
  printSites,
  proseSurface,
  readCommandTable,
  scanSource
} from '../check-messaging.mjs'

const HOLE = String.fromCharCode(0)

test('extracts quoted and template literals, and skips comments', () => {
  const source = [
    "// 'not a literal'",
    '/* `neither is this` */',
    "const a = 'one'",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, not a template.
    'const b = `two ${x} three`'
  ].join('\n')
  const literals = scanSource(source)
  assert.deepEqual(
    literals.map((l) => l.text),
    ['one', `two ${HOLE} three`]
  )
  assert.equal(literals[1].holes.length, 1)
  assert.equal(literals[1].holes[0].source, 'x')
})

test('recurses into template holes so inner literals are seen', () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, not a template.
  const literals = scanSource('const a = `${colors.red(`inner ${y}`)} tail`')
  const texts = literals.map((l) => l.text)
  assert.ok(texts.includes(`inner ${HOLE}`))
})

test('a rendered line head is offset 0 and everything after a newline', () => {
  assert.deepEqual(lineHeads('a\nb'), [0, 2])
  assert.deepEqual(lineHeads('a\\nb'), [0, 3])
})

test('reports the row inside a multi-line template, not the backtick row', () => {
  const literal = scanSource('const a = `one\ntwo\nthree`')[0]
  assert.equal(literal.line, 1)
  assert.equal(lineAt(literal, literal.text.indexOf('three')), 3)
})

test('flags a retired glyph that prefixes a rendered line', () => {
  const found = findRetiredPrefixes("const p = colors.red('ERROR')")
  assert.equal(found.length, 1)
  assert.equal(found[0].glyph, 'ERROR')
})

test('flags a retired glyph after an embedded newline', () => {
  const found = findRetiredPrefixes('const m = `first line\\n⚠ second`')
  assert.equal(found.length, 1)
  assert.equal(found[0].glyph, '⚠')
})

test('flags an interpolation that occupies the line head', () => {
  const found = findRetiredPrefixes(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, not a template.
    "const m = `${colors.red('ERROR')} in ${file}`"
  )
  assert.equal(found.length, 1)
})

// The distinction the standard turns on: a body glyph is legal.
test('allows the compile glyph inside an error body', () => {
  const found = findRetiredPrefixes(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source text, not a template.
    "const m = `${prefix('error')} Compile failed.\\n  ✖✖✖ ./src/a.js`"
  )
  assert.deepEqual(found, [])
})

// Mirrors programs/develop/lib/__spec__/branding.spec.ts, which keeps rspack's
// own warning glyph on purpose. Mid-line, so the positional rule never fires.
test("allows rspack's own mid-line warning glyph", () => {
  const found = findRetiredPrefixes(
    "const input = 'WARNING in ⚠ Rspack performance recommendations:'"
  )
  assert.deepEqual(found, [])
})

test('allows a word that merely contains a retired token', () => {
  const found = findRetiredPrefixes(
    "const codes = ['E_FIRST_COMPILE', 'ERRORS_SEEN', 'compile errors']"
  )
  assert.deepEqual(found, [])
})

test('flags three dots in a message string', () => {
  const found = findAsciiEllipsis("const m = 'Building...'")
  assert.equal(found.length, 1)
})

test('ignores spreads and regex literals', () => {
  const source = [
    'const a = [...items]',
    "const b = text.replace(/\\s+/g, ' ')",
    'function f(...rest) {}'
  ].join('\n')
  assert.deepEqual(findAsciiEllipsis(source), [])
})

// A regex class holding a quote used to desynchronise the scanner and swallow
// the rest of the file into a phantom string.
test('a regex literal containing a quote does not desynchronise', () => {
  const literals = scanSource("const a = s.split(/['\"]/g)\nconst b = 'kept'")
  assert.deepEqual(
    literals.map((l) => l.text),
    ['kept']
  )
})

test('a division is not mistaken for a regex', () => {
  const literals = scanSource("const ratio = done / total\nconst m = 'kept'")
  assert.deepEqual(
    literals.map((l) => l.text),
    ['kept']
  )
})

test('allows the quoted three-dot examples the standard keeps', () => {
  const source = [
    "const a = colors.gray('google-chrome=...')",
    "const b = `update the path to the correct '/...' location.`"
  ].join('\n')
  assert.deepEqual(findAsciiEllipsis(source), [])
})

test('flags lowercase brand in prose', () => {
  const found = findBrandInSource("const m = '[extension.js] Reloading'")
  assert.equal(found.length, 1)
  assert.equal(found[0].token, 'extension.js')
})

// Every lowercase brand token in programs/ today is one of these.
test('allows identifier, path, domain, and tap-name spellings', () => {
  const source = [
    "compiler.hooks.invalid.tap('extension.js:invalid', f)",
    "const dir = path.join(home, 'extensionjs', 'telemetry')",
    "const q = '__extensionjs_classic_concat__'",
    "const layer = 'extensionjs-content-script'",
    "const id = 'devtools@extension.js'",
    "const url = 'https://extension.js.org/docs'",
    "const repo = 'https://github.com/extension-js/extension.js/issues'"
  ].join('\n')
  assert.deepEqual(findBrandInSource(source), [])
})

test('markdown prose ignores fences, inline code, and link targets', () => {
  const markdown = [
    '```sh',
    'cd extension.js',
    '```',
    'The consent file lives at `extensionjs/telemetry/consent`.',
    'See [the docs](https://extension.js.org/docs).',
    'Run extension.js in watch mode.'
  ].join('\n')
  const found = findBrandInMarkdown(markdown)
  assert.equal(found.length, 1)
  assert.equal(found[0].line, 6)
})

test('reads a table of entry objects and skips nested option copy', () => {
  const source = [
    'const COMMAND_TABLE = [',
    '  {',
    "    name: 'install',",
    "    positionals: [{name: 'browser-name', required: false}],",
    "    description: 'Install a managed browser binary',",
    '    notes: [',
    "      {usage: '--all', description: 'Removes every binary'}",
    '    ]',
    '  },',
    '  {',
    "    name: 'doctor',",
    '    description:',
    "      'Diagnose a dev session'",
    '  }',
    '] as const'
  ].join('\n')
  const table = readCommandTable(source)
  assert.deepEqual(
    table.map((entry) => entry.name),
    ['install', 'doctor']
  )
  assert.equal(table[0].description, 'Install a managed browser binary')
  assert.equal(table[1].description, 'Diagnose a dev session')
  assert.equal(table[1].line, 12)
})

test('reads the flat record shape too', () => {
  const source = [
    'export const commandDescriptions = {',
    "  dev: 'Start the development server',",
    '  build:',
    "    'Build the extension for distribution'",
    '} as const'
  ].join('\n')
  const table = readCommandTable(source)
  assert.deepEqual(
    table.map((entry) => entry.description),
    ['Start the development server', 'Build the extension for distribution']
  )
})

test('reports a missing table rather than passing silently', () => {
  assert.equal(readCommandTable('export const nothing = 1'), null)
})

test('the allowlist is the gate, so a third-person verb fails', () => {
  const entries = [
    {name: 'create', line: 1, description: 'Creates a new extension'},
    {name: 'dev', line: 2, description: 'Start the development server'}
  ]
  const found = findNonImperative(entries)
  assert.equal(found.length, 1)
  assert.equal(found[0].name, 'create')
})

test('a noun phrase fails even though no suffix rule would catch it', () => {
  const found = findNonImperative([
    {name: 'dev', line: 1, description: 'Configuration of the dev server'}
  ])
  assert.equal(found.length, 1)
})

// The heuristic guards the allowlist, never the copy. Widening the list with
// "Creates" to make a failure go away is the failure mode it exists to stop.
test('the suffix heuristic guards the verb list, not the copy', () => {
  assert.deepEqual(findWeakVerbs(['Build', 'Creates']), ['Creates'])
  assert.deepEqual(findWeakVerbs(['Build', 'Reloading']), ['Reloading'])
})

test('the shipped verb list carries no weak verb', () => {
  assert.deepEqual(findWeakVerbs(), [])
})

test('flags forbidden words on word boundaries, case-insensitively', () => {
  const source = [
    "const a = 'Extension compiled successfully in 512 ms.'",
    "const b = 'Please try again.'",
    "const c = 'Oops, something went wrong.'"
  ].join('\n')
  const found = findForbiddenWords(source)
  assert.deepEqual(
    found.map((hit) => hit.word.toLowerCase()),
    ['successfully', 'please', 'oops']
  )
})

test('a word merely containing a forbidden word is fine', () => {
  const source = "const a = 'The dev server pleased nobody, displeasing all.'"
  assert.deepEqual(findForbiddenWords(source), [])
})

test('flags an exclamation mark in a message string', () => {
  const found = findExclamations("const m = 'Extension ready!'")
  assert.equal(found.length, 1)
})

test('a negation in code never reaches the exclamation rule', () => {
  const source = "if (!ready) run()\nconst m = 'Extension ready.'"
  assert.deepEqual(findExclamations(source), [])
})

test('flags a semicolon in a message string', () => {
  const found = findSemicolons("const m = 'Build done; launching browser.'")
  assert.equal(found.length, 1)
})

test('statement semicolons never reach the semicolon rule', () => {
  const source = "const a = 1;\nconst m = 'Build done.';"
  assert.deepEqual(findSemicolons(source), [])
})

test('flags an emoji in a message string', () => {
  const found = findEmoji("const m = 'Extension ready 🚀'")
  assert.equal(found.length, 1)
  assert.equal(found[0].emoji, '🚀')
})

test('the glyph, the ellipsis, and the middle dot are not emoji', () => {
  const source = "const m = '⏵⏵⏵ Compiling… · PID 41250'"
  assert.deepEqual(findEmoji(source), [])
})

test('an allowed emoji passes and any other still fails', () => {
  const source = "const head = ' 🧩 Extension.js'\nconst m = 'Done 🎉'"
  const found = findEmoji(source, ['🧩'])
  assert.equal(found.length, 1)
  assert.equal(found[0].emoji, '🎉')
})

test('flags a rendered line opening with Invalid', () => {
  const found = findInvalidOpeners("const m = 'Invalid manifest field.'")
  assert.equal(found.length, 1)
})

test('flags an Invalid opener hiding behind a prefix hole', () => {
  const source = 'const m = `$' + "{prefix('error')} Invalid port value.`"
  assert.equal(findInvalidOpeners(source).length, 1)
})

test('Invalid mid-sentence or as a longer word is fine', () => {
  const source = [
    "const a = 'Chrome rejected an invalid pattern.'",
    "const b = 'Invalidated the cache.'"
  ].join('\n')
  assert.deepEqual(findInvalidOpeners(source), [])
})

test('flags brightBlue around a value with no typeable token', () => {
  const source = [
    'const a = colors.brightBlue(port)',
    "const b = colors.brightBlue('3000')"
  ].join('\n')
  assert.equal(findBrightBlueMisuse(source).length, 2)
})

test('brightBlue around typeable text passes', () => {
  const source = [
    "const a = colors.brightBlue('--browser edge')",
    "const b = colors.brightBlue('npx extension@latest dev')",
    "const c = colors.brightBlue('EXTENSION_DEBUG=1')",
    "const d = colors.brightBlue('pnpm dev')",
    "const e = colors.brightBlue('extension build')"
  ].join('\n')
  assert.deepEqual(findBrightBlueMisuse(source), [])
})

test('flags a period glued to a dynamic underlined value', () => {
  const source = 'const m = `Wrote $' + '{colors.underline(outputPath)}.`'
  assert.equal(findUnderlinePeriods(source).length, 1)
})

test('flags the fmt.val spelling of underline too', () => {
  const source = 'const m = `Wrote $' + '{fmt.val(zipPath)}.`'
  assert.equal(findUnderlinePeriods(source).length, 1)
})

test("a quoted name ending a sentence is the author's choice", () => {
  const source =
    'const m = `Check $' + "{colors.underline(code('extension.config.js'))}.`"
  assert.deepEqual(findUnderlinePeriods(source), [])
})

test('an underlined value followed by more prose is fine', () => {
  const source =
    'const m = `Wrote $' + '{colors.underline(outputPath)} to disk.`'
  assert.deepEqual(findUnderlinePeriods(source), [])
})

test('names the enclosing function for a violation line', () => {
  const source = [
    'export function readyMessage(browser) {',
    "  return 'Extension ready!'",
    '}',
    'const zipNote = () => {',
    "  return 'zipped'",
    '}'
  ].join('\n')
  assert.equal(functionAt(source, 2), 'readyMessage')
  assert.equal(functionAt(source, 5), 'zipNote')
  assert.equal(functionAt(source, 0), 'module scope')
})

// Imperatives that end in -s are exactly why the heuristic may not be the gate.
test('the heuristic alone would reject legitimate imperatives', () => {
  const legitimate = ['Process', 'Address', 'Express', 'Bring']
  assert.deepEqual(
    findNonImperative(
      legitimate.map((verb, index) => ({
        name: `c${index}`,
        line: index,
        description: `${verb} the thing`
      })),
      legitimate
    ),
    []
  )
})

// The surface is derived: a file that imports a messaging helper prints, so
// it is read; a spec, a dist file or a helper module itself is not a site.
test('the prose surface is derived from messaging imports, never from a list', () => {
  const sites = printSites([
    'programs/develop/dev-server/cleanup.ts',
    'programs/develop/dev-server/__spec__/cleanup.spec.ts',
    'programs/develop/lib/messaging.ts',
    'programs/develop/lib/resource-path.ts'
  ])
  assert.deepEqual(sites, ['programs/develop/dev-server/cleanup.ts'])
  const surface = proseSurface()
  for (const copy of execSync("git ls-files 'programs/**/messaging.ts'")
    .toString()
    .split('\n')
    .filter(Boolean)) {
    assert.ok(
      surface.includes(copy),
      `${copy} renders the card head and is read`
    )
  }
  for (const extra of EXTRA_PROSE_SOURCES) {
    assert.ok(surface.includes(extra))
    assert.ok(fs.existsSync(extra), `${extra} is listed but missing`)
  }
})

// docs/MESSAGING.md names the same surface the checker reads: the messaging
// copies it lists are the tracked copies, and its one hand-listed extra is
// the checker's one hand-listed extra.
test('the rulebook page and the checker name the same surface', () => {
  const page = fs.readFileSync('docs/MESSAGING.md', 'utf8')
  const listed = [
    ...page.matchAll(/^(programs\/[\w./-]+\/messaging\.ts)/gm)
  ].map((m) => m[1])
  const tracked = execSync("git ls-files 'programs/**/messaging.ts'")
    .toString()
    .split('\n')
    .filter(Boolean)
    .sort()
  assert.deepEqual([...new Set(listed)].sort(), tracked)
  for (const extra of EXTRA_PROSE_SOURCES) {
    assert.ok(page.includes(extra), `${extra} is named on the page`)
  }
})

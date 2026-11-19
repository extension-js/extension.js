import {spawnSync} from 'node:child_process'
import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {LOG_CONTEXTS} from '../dev-server/control-bridge/contracts'
import {trackTempFolders} from './helpers/temp-folders'

const require = createRequire(__filename)
const developRoot = path.resolve(__dirname, '..')
const distDir = path.join(developRoot, 'dist')
const tempFolder = trackTempFolders()

function packageDir(specifier: string) {
  return path.dirname(require.resolve(`${specifier}/package.json`))
}

// What a typed caller writes in a file of its own, checked against the
// declarations the package ships and not against the source.
const configExamples = `import type {FileConfig} from 'extension-develop'

export const startingUrl: FileConfig = {
  browser: {chrome: {startingUrl: 'https://example.com'}}
}

export const perBrowserBuildKeys: FileConfig = {
  browser: {
    firefox: {
      perfBudgets: {'service-worker': 10},
      define: {__API__: 'https://example.com'},
      transpilePackages: ['@acme/ui']
    }
  }
}

export const layeredBudgets: FileConfig = {
  perfBudgets: {'service-worker': 10000000},
  browser: {chrome: {perfBudgets: {'service-worker': 10}}}
}

export const refused: FileConfig = {
  // @ts-expect-error a key the loader never reads stays an error
  browser: {chrome: {startingUrll: 'https://example.com'}}
}
`

// The map key names the target, so only a block may leave browser out.
const browserRequired = `import type {BuildOptions, DevOptions, FileConfig} from 'extension-develop'

export const keyed: FileConfig = {
  browser: {
    chrome: {startingUrl: 'https://example.com'},
    firefox: {browser: 'firefox', noOpen: true}
  }
}

// @ts-expect-error a dev call has no map key to name the target
export const dev: DevOptions = {mode: 'development'}

// @ts-expect-error a build call has no map key to name the target
export const build: BuildOptions = {zip: true}
`

// What start and preview read from their own commands block. The two profile
// seeding keys reach the browser from dev alone, so they stay refused here.
const serveCommandKeys = `import type {FileConfig} from 'extension-develop'

export const start: FileConfig = {
  commands: {
    start: {
      perfBudgets: {'service-worker': 10},
      noOpen: true,
      startingUrl: 'https://example.com'
    }
  }
}

export const preview: FileConfig = {
  commands: {preview: {noOpen: true, startingUrl: 'https://example.com'}}
}

export const previewBudgets: FileConfig = {
  // @ts-expect-error preview builds nothing, so no budget applies
  commands: {preview: {perfBudgets: {'service-worker': 10}}}
}

export const previewKeep: FileConfig = {
  // @ts-expect-error only dev hands keepProfileChanges to the browser
  commands: {preview: {keepProfileChanges: true}}
}

export const startCopy: FileConfig = {
  // @ts-expect-error only dev hands copyFromProfile to the browser
  commands: {start: {copyFromProfile: '/tmp/profile'}}
}
`

function readmeUsageExample(): string {
  const readme = readReadme()
  const usage = readme.slice(
    readme.indexOf('\n## Usage'),
    readme.indexOf('\n## Features')
  )
  const block = usage.match(/```ts\n([\s\S]*?)```/)

  expect(block, 'README.md has no ts block under "## Usage"').not.toBeNull()

  return String(block?.[1])
}

const COMMANDS = ['dev', 'build', 'start', 'preview'] as const
const OPTION_TYPES: Record<(typeof COMMANDS)[number], string> = {
  dev: 'DevOptions',
  build: 'BuildOptions',
  start: 'StartOptions',
  preview: 'PreviewOptions'
}

interface OptionTable {
  heading: string
  commands: string[]
  rows: Array<{option: string; values: string}>
}

function readReadme(): string {
  return fs
    .readFileSync(path.join(developRoot, 'README.md'), 'utf8')
    .replace(/\r\n/g, '\n')
}

// Every table under "## Command options". The heading names the commands
// whose option type has each row of the table.
function readmeOptionTables(readme: string): OptionTable[] {
  const start = readme.indexOf('\n## Command options')
  const section = readme.slice(start, readme.indexOf('\n## ', start + 1))

  return section
    .split('\n### ')
    .slice(1)
    .map((block) => {
      const [heading, ...lines] = block.split('\n')
      const rows = lines
        .filter((line) => line.startsWith('|'))
        .slice(2)
        .map((line) => line.split('|').map((cell) => cell.trim()))
        .map((cells) => ({
          option: cells[1].replace(/`/g, ''),
          values: cells[2]
        }))

      return {
        heading,
        commands: COMMANDS.filter((command) =>
          new RegExp(`\\b${command}\\b`).test(heading)
        ),
        rows
      }
    })
}

const union = (names: string[]) =>
  names.length > 0 ? names.map((name) => `'${name}'`).join(' | ') : 'never'

// A table holds the options every command of its heading has, less the ones
// a table for more commands already lists. tsc names each row that is off.
function optionTableProgram(tables: OptionTable[]): string {
  const lines = [
    `import type {${Object.values(OPTION_TYPES).join(', ')}} from 'extension-develop'`,
    ''
  ]

  tables.forEach((table, index) => {
    const wider = tables
      .map((other, otherIndex) => ({other, otherIndex}))
      .filter(
        ({other}) =>
          other.commands.length > table.commands.length &&
          table.commands.every((command) => other.commands.includes(command))
      )
      .map(({otherIndex}) => `Expected${otherIndex}`)

    const shared = table.commands
      .map(
        (command) =>
          `keyof ${OPTION_TYPES[command as keyof typeof OPTION_TYPES]}`
      )
      .join(' & ')

    lines.push(
      `type Expected${index} = Exclude<${shared || 'never'}, ${wider.join(' | ') || 'never'}>`,
      `type Rows${index} = ${union(table.rows.map((row) => row.option))}`,
      `export const missing${index}: [Exclude<Expected${index}, Rows${index}>] extends [never]`,
      `  ? true`,
      `  : {tableLacksTheOption: Exclude<Expected${index}, Rows${index}>} = true`,
      `export const unknown${index}: [Exclude<Rows${index}, Expected${index}>] extends [never]`,
      `  ? true`,
      `  : {tableNamesNoSuchOption: Exclude<Rows${index}, Expected${index}>} = true`,
      ''
    )
  })

  return lines.join('\n')
}

function writeProject(files: Record<string, string>): string {
  const root = tempFolder('extjs-public-types-')

  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), source)
  }

  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'esnext',
        target: 'esnext',
        moduleResolution: 'bundler',
        lib: ['dom', 'esnext'],
        noEmit: true,
        noErrorTruncation: true,
        skipLibCheck: true,
        typeRoots: [path.dirname(packageDir('@types/node'))],
        types: ['node'],
        paths: {
          'extension-develop': [path.join(distDir, 'module.d.ts')],
          'extension-develop/preview': [
            path.join(distDir, 'preview-entry.d.ts')
          ]
        }
      },
      files: Object.keys(files)
    })
  )

  return root
}

// The keys of one commands block in the shipped FileConfig whose doc comment
// carries a deprecated tag. tsc never reports that tag, so the text is read.
function deprecatedKeys(command: string, next: string): string[] {
  const declarations = fs.readFileSync(path.join(distDir, 'types.d.ts'), 'utf8')
  const start = declarations.indexOf(`\n        ${command}?: Pick<`)
  const end = declarations.indexOf(`\n        ${next}?: Pick<`, start)

  expect(start, `no commands.${command} block`).toBeGreaterThan(-1)
  expect(end, `no commands.${next} block`).toBeGreaterThan(start)

  return [
    ...declarations
      .slice(start, end)
      .matchAll(/\/\*\*[^/]*@deprecated[^/]*\*\/\s*(\w+)\?:/g)
  ].map((match) => match[1])
}

function typecheck(files: Record<string, string>) {
  const root = writeProject(files)

  const run = spawnSync(
    process.execPath,
    [
      path.join(packageDir('typescript'), 'bin', 'tsc'),
      '-p',
      root,
      '--pretty',
      'false'
    ],
    {cwd: root, encoding: 'utf8'}
  )

  return {
    status: run.status,
    errors: `${run.stdout}\n${run.stderr}`
      .split('\n')
      .filter((line) => line.includes('error TS'))
  }
}

describe('the declarations extension-develop ships', () => {
  beforeAll(() => {
    if (!fs.existsSync(path.join(distDir, 'module.d.ts'))) {
      throw new Error(
        `${distDir}/module.d.ts does not exist. Run ` +
          '`pnpm --filter extension-develop compile` before vitest.'
      )
    }
  })

  it('accept every browser key the config loader reads', () => {
    const result = typecheck({'extension.config.ts': configExamples})

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)

  it('want browser wherever no map key names the target', () => {
    const result = typecheck({'browser-required.ts': browserRequired})

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)

  it('accept what start and preview read from their commands block', () => {
    const result = typecheck({'serve-command-keys.ts': serveCommandKeys})

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)

  it('mark the two keys commands.preview never reads as deprecated', () => {
    expect(deprecatedKeys('preview', 'build')).toEqual([
      'transpilePackages',
      'define'
    ])

    expect(deprecatedKeys('start', 'preview')).toEqual([])
    expect(deprecatedKeys('dev', 'start')).toEqual([])
  })

  it('compile the Usage example of the README as written', () => {
    const example = readmeUsageExample()

    expect(example).toContain('extensionBuild(')
    expect(example).toContain('extensionPreview(')

    const result = typecheck({'usage.ts': example})

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)

  it('refuse the calls the old README example made', () => {
    const result = typecheck({
      'old-usage.ts': `import {extensionDev, type DevOptions} from 'extension-develop'
// @ts-expect-error there is no extensionStart export
import {extensionStart} from 'extension-develop'

export const start: unknown = extensionStart
export const dev = () =>
  extensionDev(undefined, {
    browser: 'chrome',
    mode: 'development',
    // @ts-expect-error open is not an option
    open: true
  } satisfies DevOptions)
`
    })

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)

  it('keep the fields only the CLI sets off the option types', () => {
    const internal: Record<string, string[]> = {
      DevOptions: ['install'],
      BuildOptions: ['install', 'metadataCommand', 'launchFollows'],
      StartOptions: ['install'],
      PreviewOptions: ['metadataCommand', 'instanceId', 'instanceExplicit'],
      EntryPreviewOptions: ['metadataCommand', 'instanceId', 'instanceExplicit']
    }

    const probes = Object.entries(internal).flatMap(([type, fields]) =>
      fields.map(
        (field, index) => `export const ${type}${index}: Partial<${type}> = {
  // @ts-expect-error ${field} is not a public option
  ${field}: undefined
}`
      )
    )

    const result = typecheck({
      'internal-fields.ts': `import type {BuildOptions, DevOptions, PreviewOptions, StartOptions} from 'extension-develop'
import type {PreviewOptions as EntryPreviewOptions} from 'extension-develop/preview'

${probes.join('\n\n')}

// The engine still takes them, so the CLI passes them with no cast.
export const build: BuildOptions = {browser: 'chrome', zip: true}
`
    })

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)
})

describe('the option tables of the README', () => {
  const tables = readmeOptionTables(readReadme())

  it('have one table per command and no row twice', () => {
    for (const command of COMMANDS) {
      expect(
        tables.filter(
          (table) =>
            table.commands.length === 1 && table.commands[0] === command
        ),
        `README.md needs one "### ${command}" table under "## Command options"`
      ).toHaveLength(1)
    }

    for (const table of tables) {
      const names = table.rows.map((row) => row.option)

      expect(
        table.commands,
        `"### ${table.heading}" names no command`
      ).not.toEqual([])

      expect(names, `"### ${table.heading}" has no rows`).not.toEqual([])
      expect(new Set(names).size, `"### ${table.heading}"`).toBe(names.length)
    }
  })

  it('list every option of the shipped option types and no other', () => {
    const result = typecheck({'option-tables.ts': optionTableProgram(tables)})

    expect(result.errors).toEqual([])
    expect(result.status).toBe(0)
  }, 120_000)

  it('are refused with a row for no option, or with an option left out', () => {
    const drifted = tables.map((table) =>
      table.heading === 'dev'
        ? {
            ...table,
            rows: [...table.rows.slice(1), {option: 'open', values: 'boolean'}]
          }
        : table
    )
    const dropped = tables.find((table) => table.heading === 'dev')?.rows[0]
    const result = typecheck({'option-tables.ts': optionTableProgram(drifted)})
    const errors = result.errors.join('\n')

    expect(result.status).not.toBe(0)
    expect(errors).toContain('tableNamesNoSuchOption: "open"')
    expect(errors).toContain(`tableLacksTheOption: "${dropped?.option}"`)
  }, 120_000)

  it('list every log context the engine knows', () => {
    const row = tables
      .flatMap((table) => table.rows)
      .find((entry) => entry.option === 'logContexts')

    expect(row, 'no table has a logContexts row').toBeDefined()

    const listed = String(row?.values)
      .replace(/^array of:/, '')
      .split(',')
      .map((name) => name.trim())

    expect(listed).toEqual([...LOG_CONTEXTS])
  })
})

describe('types.ts', () => {
  const source = fs.readFileSync(path.join(developRoot, 'types.ts'), 'utf8')

  it('spells each union the option types share once', () => {
    expect(source.match(/\blogLevel\?:/g)).toHaveLength(1)
    expect(source.match(/\blogContexts\?:/g)).toHaveLength(1)
    expect(source.match(/'dev' \| '(?:start|build)' \|/g)).toHaveLength(1)
  })

  it('marks the build options that nothing reads as deprecated', () => {
    for (const option of ['failOnWarning', 'exitOnError']) {
      expect(source).toMatch(
        new RegExp(`@deprecated[^/]*\\*/\\s*${option}\\?:`)
      )
    }
  })
})

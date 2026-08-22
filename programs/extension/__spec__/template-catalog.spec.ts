import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {registerCreateCommand} from '../commands/create'
import {programAIHelp, programAIHelpJSON} from '../helpers/messages'
import {
  BUNDLED_TEMPLATES,
  CURATED_GROUPS,
  DEFAULT_TEMPLATE,
  listTemplates,
  renderTemplateList,
  TEMPLATE_ALIASES,
  TEMPLATE_CATALOG_URL,
  TEMPLATE_GROUPS,
  templateAliasFor,
  UNCURATED_GROUP_TITLE
} from '../helpers/template-catalog'
import {
  TEMPLATE_CORPUS_REF,
  TEMPLATE_CORPUS_REPO,
  TEMPLATE_CORPUS_SLUGS
} from '../helpers/template-corpus.generated'
import {makeProgram} from './command-harness'

// The scaffolder lives in a sibling package that costs a quarter of a second to
// import, so the CLI cannot read these values at runtime. Read them off the
// source text instead: an independent file, no build step, and a reformat that
// breaks the match fails the spec rather than passing it.
const SCAFFOLDER_SOURCE = path.resolve(
  __dirname,
  '../../create/steps/import-external-template.ts'
)

function readScaffolderLiteral(pattern: RegExp): string {
  const source = fs.readFileSync(SCAFFOLDER_SOURCE, 'utf8')
  const match = pattern.exec(source)
  if (!match) {
    throw new Error(
      `Could not read ${pattern} from ${path.basename(SCAFFOLDER_SOURCE)}`
    )
  }
  return match[1]
}

const LIVE_CATALOG_API = `https://api.github.com/repos/${TEMPLATE_CORPUS_REPO}/contents/examples?ref=${TEMPLATE_CORPUS_REF}`

function createHelp(): string {
  const program = makeProgram(registerCreateCommand)
  const create = program.commands.find((c) => c.name() === 'create')
  if (!create) throw new Error('create command not registered')

  let captured = ''
  create.configureOutput({
    writeOut: (chunk: string) => {
      captured += chunk
    }
  })
  create.outputHelp()
  return captured
}

describe('template catalog', () => {
  it('lists every group template exactly once', () => {
    const names = listTemplates()
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps the default inside the catalog', () => {
    expect(listTemplates()).toContain(DEFAULT_TEMPLATE)
  })

  it('never advertises an alias as a catalog name', () => {
    for (const alias of TEMPLATE_ALIASES) {
      expect(listTemplates()).not.toContain(alias.name)
      expect(listTemplates()).toContain(alias.resolvesTo)
    }
  })

  it('lists init as an ordinary name that is not the default', () => {
    expect(listTemplates()).toContain('init')
    expect(templateAliasFor('init')).toBeUndefined()
    expect(DEFAULT_TEMPLATE).not.toBe('init')
  })

  it('points no name at a template other than itself', () => {
    for (const name of listTemplates()) {
      expect(templateAliasFor(name), name).toBeUndefined()
    }
  })

  it('renders every name in the plain listing', () => {
    const rendered = renderTemplateList({color: false})
    for (const name of listTemplates()) {
      expect(rendered).toContain(name)
    }
  })

  it('renders no alias section while the alias list is empty', () => {
    if (TEMPLATE_ALIASES.length > 0) return
    const rendered = renderTemplateList({color: false})
    expect(rendered).not.toContain('Aliases')
    expect(rendered.endsWith('\n')).toBe(false)
  })
})

describe('extension create --help', () => {
  it('names the default template on the option itself', () => {
    const collapsed = createHelp().replace(/\s+/g, ' ')
    expect(collapsed).toContain(`(default: ${DEFAULT_TEMPLATE})`)
  })

  it('lists every catalog name a human can pass', () => {
    const help = createHelp()
    for (const name of listTemplates()) {
      expect(help).toContain(name)
    }
  })

  it('points at the catalog it downloads from', () => {
    expect(createHelp()).toContain(TEMPLATE_CATALOG_URL)
  })
})

describe('--ai-help', () => {
  it('teaches the same names the CLI can scaffold', () => {
    const pretty = programAIHelp()
    for (const name of listTemplates()) {
      expect(pretty).toContain(name)
    }
  })

  it('never advertises a name outside the catalog', () => {
    const json = programAIHelpJSON('0.0.0')
    const advertised = json.templates.names
    expect(advertised).toEqual(listTemplates())
    expect(json.templates.default).toBe(DEFAULT_TEMPLATE)
    expect(json.templates.bundled).toEqual([...BUNDLED_TEMPLATES])
    expect(json.templates.corpus).toEqual({
      repo: TEMPLATE_CORPUS_REPO,
      ref: TEMPLATE_CORPUS_REF
    })
  })

  it('declares every alias, and each one resolves to a listed name', () => {
    const json = programAIHelpJSON('0.0.0')
    // The key was omitted while no alias existed. The new-tab templates were
    // renamed from `new*` to `newtab*`, so real aliases exist again and the
    // machine-readable help has to carry them: a reader that only sees `names`
    // would conclude `new-react` is gone rather than renamed.
    expect(Array.isArray(json.templates.aliases)).toBe(true)
    for (const alias of json.templates.aliases as {
      name: string
      resolvesTo: string
    }[]) {
      expect(json.templates.names).not.toContain(alias.name)
      expect(json.templates.names).toContain(alias.resolvesTo)
    }
    expect(json.templates.names).toContain('init')
  })
})

// The offline half of the drift guard. It compares three things that live in
// three files and are edited by three different reasons: the names the help
// advertises, the corpus generated from the examples repo, and the commit the
// scaffolder downloads. 4.0.30 shipped with those three disagreeing, `--help`
// offered `sidebar-monorepo-turborepo` against a pinned corpus that published
// `sidebar-monorepo-turbopack`, and the failure message told the reader to
// consult the list that had just lied to them.
describe('catalog matches the corpus it scaffolds from', () => {
  it('advertises exactly the names the pinned corpus publishes', () => {
    expect([...listTemplates()].sort()).toEqual(
      [...TEMPLATE_CORPUS_SLUGS].sort()
    )
  })

  it('curates no name the pinned corpus does not publish', () => {
    const published = new Set(TEMPLATE_CORPUS_SLUGS)
    const stale = CURATED_GROUPS.flatMap((group) => group.templates).filter(
      (name) => !published.has(name)
    )
    expect(stale).toEqual([])
  })

  it('advertises the commit the scaffolder actually downloads', () => {
    const pinned = readScaffolderLiteral(
      /export const DEFAULT_TEMPLATES_REF = '([0-9a-f]{40})'/
    )
    expect(TEMPLATE_CORPUS_REF).toBe(pinned)
  })

  it('links the listing at that same commit, not at the branch tip', () => {
    expect(TEMPLATE_CATALOG_URL).toContain(TEMPLATE_CORPUS_REF)
    expect(TEMPLATE_CATALOG_URL).not.toContain('/tree/main/')
  })

  it('claims offline scaffolding only for templates the package carries', () => {
    const bundled = readScaffolderLiteral(
      /export const BUNDLED_TEMPLATES: readonly string\[\] = \[([^\]]*)\]/
    )
    const scaffolderNames = [...bundled.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect([...BUNDLED_TEMPLATES]).toEqual(scaffolderNames)
    for (const name of BUNDLED_TEMPLATES) {
      expect(
        fs.existsSync(path.resolve(__dirname, '../../create/templates', name)),
        name
      ).toBe(true)
    }
  })

  it('defaults to a name the corpus publishes', () => {
    expect(TEMPLATE_CORPUS_SLUGS).toContain(DEFAULT_TEMPLATE)
  })

  // Curation is allowed to lag the corpus; the listing is not. A template
  // nobody has grouped yet is still one the CLI can scaffold, so it has to
  // reach the reader rather than wait for someone to file it.
  it('lists a published name no group claims', () => {
    const curated = new Set(CURATED_GROUPS.flatMap((group) => group.templates))
    const uncurated = TEMPLATE_CORPUS_SLUGS.filter((name) => !curated.has(name))
    const rendered = renderTemplateList({color: false})

    for (const name of uncurated) {
      expect(listTemplates(), name).toContain(name)
      expect(rendered, name).toContain(name)
    }
    if (uncurated.length) {
      expect(rendered).toContain(UNCURATED_GROUP_TITLE)
    }
  })
})

const liveIt =
  process.env.EXTENSION_TEMPLATE_CATALOG_LIVE === '1' ? it : it.skip

describe('catalog drift', () => {
  liveIt(
    'matches the folders published at the pinned commit',
    async () => {
      const response = await fetch(LIVE_CATALOG_API, {
        headers: {'User-Agent': 'extension-template-catalog-drift'}
      })
      expect(response.ok).toBe(true)

      const entries = (await response.json()) as Array<{
        name: string
        type: string
      }>
      const published = entries
        .filter((entry) => entry.type === 'dir')
        .map((entry) => entry.name)
        .sort()

      const bundled = [
        ...listTemplates(),
        ...TEMPLATE_ALIASES.map((alias) => alias.name)
      ].sort()

      expect(bundled).toEqual(published)
    },
    60_000
  )

  // A pin is only reproducible while the commit stays reachable. 4.0.30 pinned
  // a bot commit that shares no ancestor with the corpus branch; GitHub served
  // it, and never promised to keep doing so.
  liveIt(
    'pins a commit the corpus branch still contains',
    async () => {
      const response = await fetch(
        `https://api.github.com/repos/${TEMPLATE_CORPUS_REPO}/compare/main...${TEMPLATE_CORPUS_REF}`,
        {headers: {'User-Agent': 'extension-template-catalog-drift'}}
      )
      expect(response.status).not.toBe(404)
      const body = (await response.json()) as {status?: string}
      expect(['behind', 'identical']).toContain(body.status)
    },
    60_000
  )
})

describe('catalog groups', () => {
  it('gives every group a title and a summary', () => {
    for (const group of TEMPLATE_GROUPS) {
      expect(group.title.length).toBeGreaterThan(0)
      expect(group.summary.length).toBeGreaterThan(0)
      expect(group.templates.length).toBeGreaterThan(0)
    }
  })
})

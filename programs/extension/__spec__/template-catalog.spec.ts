import {describe, expect, it} from 'vitest'
import {registerCreateCommand} from '../commands/create'
import {programAIHelp, programAIHelpJSON} from '../helpers/messages'
import {
  DEFAULT_TEMPLATE,
  listTemplates,
  renderTemplateList,
  TEMPLATE_ALIASES,
  TEMPLATE_CATALOG_URL,
  TEMPLATE_GROUPS,
  templateAliasFor
} from '../helpers/template-catalog'
import {makeProgram} from './command-harness'

const LIVE_CATALOG_API =
  'https://api.github.com/repos/extension-js/examples/contents/examples?ref=main'

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
    expect(json.templates.bundled).toEqual([DEFAULT_TEMPLATE])
  })

  it('declares no substitution, because every name delivers itself', () => {
    const json = programAIHelpJSON('0.0.0')
    expect(json.templates.aliases).toEqual([])
    expect(json.templates.names).toContain('init')
  })
})

const liveIt =
  process.env.EXTENSION_TEMPLATE_CATALOG_LIVE === '1' ? it : it.skip

describe('catalog drift', () => {
  liveIt(
    'matches the folders published in extension-js/examples',
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

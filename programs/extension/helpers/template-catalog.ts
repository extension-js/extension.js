//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'

export const DEFAULT_TEMPLATE = 'javascript'

export const TEMPLATE_CATALOG_URL =
  'https://github.com/extension-js/examples/tree/main/examples'

export interface TemplateGroup {
  title: string
  summary: string
  templates: string[]
}

export interface TemplateAlias {
  name: string
  resolvesTo: string
  note: string
}

export const TEMPLATE_GROUPS: readonly TemplateGroup[] = [
  {
    title: 'Starters',
    summary: 'a bare manifest, or one language or framework with sidebar UI',
    templates: [
      'init',
      'javascript',
      'typescript',
      'react',
      'preact',
      'vue',
      'svelte'
    ]
  },
  {
    title: 'Sidebar',
    summary: 'side panel on Chromium, sidebar action on Firefox',
    templates: [
      'sidebar',
      'sidebar-antd',
      'sidebar-shadcn',
      'sidebar-monorepo-turbopack',
      'ai-chatgpt',
      'ai-claude',
      'ai-gemini',
      'ai-perplexity',
      'playwright',
      'transformers-js'
    ]
  },
  {
    title: 'Content scripts',
    summary: 'code injected into the pages you browse',
    templates: [
      'content',
      'content-css-modules',
      'content-custom-font',
      'content-env',
      'content-less',
      'content-less-modules',
      'content-main-world',
      'content-multi-one-entry',
      'content-multi-three-entries',
      'content-preact',
      'content-react',
      'content-sass',
      'content-sass-modules',
      'content-svelte',
      'content-typescript',
      'content-vue'
    ]
  },
  {
    title: 'New tab',
    summary: 'replaces the browser new tab page',
    templates: [
      'new',
      'new-browser-flags',
      'new-config-eslint',
      'new-config-prettier',
      'new-config-stylelint',
      'new-crypto',
      'new-env',
      'new-less',
      'new-preact',
      'new-react',
      'new-react-router',
      'new-sass',
      'new-svelte',
      'new-typescript',
      'new-vue'
    ]
  },
  {
    title: 'Toolbar action',
    summary: 'popup opened from the toolbar button',
    templates: ['action', 'action-locales']
  },
  {
    title: 'Special folders',
    summary: 'pages/ and scripts/ entrypoints',
    templates: ['special-folders-pages', 'special-folders-scripts']
  }
]

/* @invariant A NAME IN THIS LIST DELIVERS SOMETHING OTHER THAN ITSELF, WHICH IS
 * WHY THE LIST IS EMPTY AND SHOULD STAY THAT WAY.
 *
 * It held one entry, `init`, which scaffolded `javascript` while a genuinely
 * different `init` folder sat in the catalog: a bare manifest with icons and no
 * background, content script or sidebar. Eleven people typed the word in the
 * ninety days before 2026-07-30 and every one of them received an extension
 * nobody asked for. The first fix was to disclose the redirection in the help
 * text, which made the CLI honest about lying. Cezar ruled on 2026-07-30 that
 * it be true to its word instead, so `init` is now an ordinary catalog name and
 * resolves to the folder it names.
 *
 * The mechanism survives for a real alias, one where two names genuinely mean
 * the same template. It must never again be used to point a name at different
 * bytes, because a listing that teaches the wrong contract is worse than no
 * listing at all.
 */
export const TEMPLATE_ALIASES: readonly TemplateAlias[] = []

export function listTemplates(): string[] {
  return TEMPLATE_GROUPS.flatMap((group) => group.templates)
}

export function templateAliasFor(name: string): TemplateAlias | undefined {
  return TEMPLATE_ALIASES.find((alias) => alias.name === name)
}

function wrapSlugs(slugs: string[], indent: string, width: number): string[] {
  const lines: string[] = []
  let current = ''

  for (const slug of slugs) {
    const candidate = current ? `${current}, ${slug}` : slug
    if (current && indent.length + candidate.length + 1 > width) {
      lines.push(`${indent}${current},`)
      current = slug
      continue
    }
    current = candidate
  }

  if (current) lines.push(indent + current)
  return lines
}

export interface RenderTemplateListOptions {
  color?: boolean
  width?: number
}

export function renderTemplateList({
  color = true,
  width = 78
}: RenderTemplateListOptions = {}): string {
  const title = (text: string) => (color ? colors.green(text) : text)
  const dim = (text: string) => (color ? colors.gray(text) : text)
  const slug = (text: string) => (color ? colors.blue(text) : text)

  const lines: string[] = []

  for (const group of TEMPLATE_GROUPS) {
    lines.push(`  ${title(group.title)} ${dim(`(${group.summary})`)}`)
    for (const line of wrapSlugs(group.templates, '    ', width)) {
      lines.push(slug(line))
    }
    lines.push('')
  }

  // The group loop leaves a trailing blank line for the next section to sit
  // under. Drop it when the alias list is empty, a heading over nothing
  // teaches a redirection mechanism that no longer redirects anything.
  lines.pop()

  if (TEMPLATE_ALIASES.length > 0) {
    lines.push('')
    lines.push(`  ${title('Aliases')}`)
    for (const alias of TEMPLATE_ALIASES) {
      lines.push(`    ${slug(alias.name)} ${dim(alias.note)}`)
      lines.push(
        dim('      pass its URL to scaffold the catalog folder instead')
      )
    }
  }

  return lines.join('\n')
}

export function renderCreateTemplateHelp(): string {
  const total = listTemplates().length
  const dim = (text: string) => colors.gray(text)

  return [
    '',
    colors.underline(colors.blue(`Templates (${total})`)),
    renderTemplateList(),
    '',
    `  ${colors.green('Default')}`,
    `    ${colors.blue(DEFAULT_TEMPLATE)} ${dim('is used when --template is omitted. It ships inside the CLI,')}`,
    dim('    so it scaffolds with no network call.'),
    '',
    `  ${colors.green('Everything else')}`,
    dim('    downloads the catalog archive at create time, so it needs the'),
    dim('    network and takes longer. A GitHub URL or a ZIP URL also works.'),
    `    ${colors.blue(TEMPLATE_CATALOG_URL)}`,
    ''
  ].join('\n')
}

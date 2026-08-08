import {describe, expect, it} from 'vitest'
import {
  findLegacyManifestPathHits,
  LEGACY_MANIFEST_PATH_RULES,
  normalizeLegacyPathRef
} from '../manifest-lib/legacy-paths'

function setField(
  manifest: Record<string, unknown>,
  field: string,
  value: unknown
): Record<string, unknown> {
  const parts = field.split('.')
  if (parts.length === 1) {
    return {...manifest, [field]: value}
  }
  const [head, ...rest] = parts
  const child = (manifest[head] as Record<string, unknown> | undefined) || {}
  return {
    ...manifest,
    [head]: setField(child, rest.join('.'), value)
  }
}

describe('normalizeLegacyPathRef', () => {
  it('strips leading ./ and / and normalizes backslashes', () => {
    expect(normalizeLegacyPathRef('./options_ui/page.html')).toBe(
      'options_ui/page.html'
    )
    expect(normalizeLegacyPathRef('/options_ui/page.html')).toBe(
      'options_ui/page.html'
    )
    expect(normalizeLegacyPathRef('options_ui\\page.html')).toBe(
      'options_ui/page.html'
    )
  })
})

describe('findLegacyManifestPathHits', () => {
  it.each(
    LEGACY_MANIFEST_PATH_RULES.map(
      (rule) => [rule.field, rule.legacyPath, rule.modernPath] as const
    )
  )('flags %s when set to the old scaffold path %s', (field, legacyPath, modernPath) => {
    const manifest = setField(
      {manifest_version: 3, name: 'x', version: '1.0.0'},
      field,
      legacyPath
    )

    expect(findLegacyManifestPathHits(manifest)).toEqual([
      {field, legacyPath, modernPath}
    ])
  })

  it.each(
    LEGACY_MANIFEST_PATH_RULES.map(
      (rule) => [rule.field, rule.legacyPath, rule.modernPath] as const
    )
  )('flags %s when the old path is written with ./ or a leading slash', (field, legacyPath, modernPath) => {
    const withDot = setField({}, field, `./${legacyPath}`)
    const withSlash = setField({}, field, `/${legacyPath}`)

    expect(findLegacyManifestPathHits(withDot)).toEqual([
      {field, legacyPath, modernPath}
    ])
    expect(findLegacyManifestPathHits(withSlash)).toEqual([
      {field, legacyPath, modernPath}
    ])
  })

  it.each(
    LEGACY_MANIFEST_PATH_RULES.map(
      (rule) => [rule.field, rule.modernPath] as const
    )
  )('stays silent when %s already points at %s', (field, modernPath) => {
    const manifest = setField({}, field, modernPath)
    expect(findLegacyManifestPathHits(manifest)).toEqual([])
  })

  it('returns every old-layout field that is still in use', () => {
    const manifest: Record<string, unknown> = {
      devtools_page: 'devtools_page/devtools_page.html',
      options_ui: {page: 'options_ui/page.html'},
      background: {page: 'background/page.html'},
      browser_action: {default_popup: 'browser_action/default_popup.html'},
      page_action: {default_popup: 'page_action/default_popup.html'},
      side_panel: {default_path: 'side_panel/default_path.html'},
      sidebar_action: {default_panel: 'sidebar_action/default_panel.html'}
    }

    expect(findLegacyManifestPathHits(manifest)).toEqual(
      LEGACY_MANIFEST_PATH_RULES.map((rule) => ({
        field: rule.field,
        legacyPath: rule.legacyPath,
        modernPath: rule.modernPath
      }))
    )
  })

  it('never fires when the old path string only appears in unrelated fields', () => {
    const manifest = {
      name: 'x',
      description: 'docs mention options_ui/page.html and background/page.html',
      homepage_url: 'https://example.com/options_ui/page.html',
      web_accessible_resources: [
        {
          resources: [
            'options_ui/page.html',
            'devtools_page/devtools_page.html',
            'browser_action/default_popup.html'
          ],
          matches: ['<all_urls>']
        }
      ],
      // Real entrypoints use modern paths; only the noise strings look legacy.
      options_ui: {page: 'options/index.html'},
      action: {default_popup: 'action/index.html'},
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content.js'],
          // A content-script css path that happens to share the old basename.
          css: ['options_ui/page.html']
        }
      ]
    }

    expect(findLegacyManifestPathHits(manifest)).toEqual([])
  })

  it('does not treat a different field that holds another field legacy path as a hit', () => {
    // options_ui.page set to the *devtools* legacy path is not the options
    // scaffold layout; only the field's own legacy path is a hit.
    const manifest = {
      options_ui: {page: 'devtools_page/devtools_page.html'},
      background: {page: 'options_ui/page.html'}
    }

    expect(findLegacyManifestPathHits(manifest)).toEqual([])
  })

  it('ignores non-string field values', () => {
    expect(
      findLegacyManifestPathHits({
        options_ui: {page: {path: 'options_ui/page.html'}},
        background: {page: ['background/page.html']},
        devtools_page: 12
      })
    ).toEqual([])
  })

  it('returns nothing for a non-object manifest', () => {
    expect(findLegacyManifestPathHits(null)).toEqual([])
    expect(findLegacyManifestPathHits(undefined)).toEqual([])
    expect(findLegacyManifestPathHits('options_ui/page.html')).toEqual([])
  })
})

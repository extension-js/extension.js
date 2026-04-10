import {describe, expect, it} from 'vitest'
import {
  buildContentScriptProbePlan,
  buildIterationExpectations,
  contentScriptProbeId,
  evaluateDeterministicHmrIterations,
  extractUpdatedHtmlFromNdjson,
  listManifestContentScriptFiles
} from '../../run-chromium/chromium-source-inspection/deterministic-hmr-harness'

describe('deterministic HMR harness', () => {
  it('extracts ordered unique content_scripts js entries from manifest', () => {
    const manifest = {
      content_scripts: [
        {
          js: ['src/content_scripts/a.ts', 'src/content_scripts/b.ts']
        },
        {
          js: ['src/content_scripts/b.ts', 'src/content_scripts/c.tsx']
        }
      ]
    }

    expect(listManifestContentScriptFiles(manifest)).toEqual([
      'src/content_scripts/a.ts',
      'src/content_scripts/b.ts',
      'src/content_scripts/c.tsx'
    ])
  })

  it('builds stable probe IDs with bounded size', () => {
    const shortPath =
      'src/content_scripts/phishing-notifications/content-index.tsx'
    const shortId = contentScriptProbeId(shortPath)
    expect(shortId.startsWith('extjs-hmr-probe-')).toBe(true)
    expect(shortId).toContain('phishing-notifications')

    const longPath =
      'src/content_scripts/' + 'very-long-segment/'.repeat(20) + 'entry.ts'
    const longId = contentScriptProbeId(longPath)
    expect(longId.startsWith('extjs-hmr-probe-')).toBe(true)
    expect(longId.length).toBeLessThanOrEqual(80)
  })

  it('parses updated page_html events from mixed ndjson output', () => {
    const output = [
      'non-json line',
      '{"type":"action_event","stage":"updated"}',
      '{"type":"page_html","stage":"post_injection","html":"<div>ignore</div>"}',
      '{"type":"page_html","stage":"updated","html":"<div>u1</div>"}',
      '{"type":"page_html","stage":"updated","html":"<div>u2</div>"}'
    ].join('\n')

    expect(extractUpdatedHtmlFromNdjson(output)).toEqual([
      '<div>u1</div>',
      '<div>u2</div>'
    ])
  })

  it('evaluates one updated snapshot per expected content-script token', () => {
    const manifest = {
      content_scripts: [
        {
          js: ['src/content_scripts/a.ts', 'src/content_scripts/b.ts']
        }
      ]
    }
    const plan = buildContentScriptProbePlan(manifest)
    const expectations = buildIterationExpectations(plan, 'v42')
    const snapshots = [
      `<html><body>${expectations[0].expectedToken}</body></html>`,
      `<html><body>${expectations[1].expectedToken}</body></html>`
    ]

    const results = evaluateDeterministicHmrIterations(expectations, snapshots)
    expect(results.every((result) => result.passed)).toBe(true)
  })

  it('fails when an iteration token is missing from its updated snapshot', () => {
    const expectations = [
      {
        scriptPath: 'src/content_scripts/a.ts',
        expectedToken: 'extjs-hmr-probe-a:v1'
      }
    ]
    const snapshots = ['<html><body>no token</body></html>']

    const [result] = evaluateDeterministicHmrIterations(expectations, snapshots)

    expect(result.passed).toBe(false)
    expect(result.reason).toContain('not found')
  })
})

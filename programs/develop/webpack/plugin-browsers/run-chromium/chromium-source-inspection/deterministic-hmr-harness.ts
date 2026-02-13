type ManifestLike = {
  content_scripts?: Array<{
    js?: unknown
  }>
}

export type ContentScriptProbe = {
  scriptPath: string
  probeId: string
}

export type HmrIterationExpectation = {
  scriptPath: string
  expectedToken: string
}

export type HmrIterationResult = {
  scriptPath: string
  expectedToken: string
  snapshotIndex: number
  passed: boolean
  reason: string
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function listManifestContentScriptFiles(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== 'object') return []

  const normalized = manifest as ManifestLike
  const groups = Array.isArray(normalized.content_scripts)
    ? normalized.content_scripts
    : []

  const seen = new Set<string>()
  const ordered: string[] = []

  for (const group of groups) {
    const list = Array.isArray(group?.js) ? group.js : []
    for (const item of list) {
      const scriptPath = String(item || '').trim()
      if (!scriptPath || seen.has(scriptPath)) continue
      seen.add(scriptPath)
      ordered.push(scriptPath)
    }
  }

  return ordered
}

export function contentScriptProbeId(scriptPath: string): string {
  const base = scriptPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')

  const prefix = 'extjs-hmr-probe-'
  const preferred = `${prefix}${base}`

  if (preferred.length <= 80) return preferred
  return `${prefix}${base.slice(0, 55)}-${fnv1a(scriptPath)}`
}

export function buildContentScriptProbePlan(
  manifest: unknown
): ContentScriptProbe[] {
  const files = listManifestContentScriptFiles(manifest)
  return files.map((scriptPath) => ({
    scriptPath,
    probeId: contentScriptProbeId(scriptPath)
  }))
}

export function buildIterationExpectations(
  probePlan: ContentScriptProbe[],
  tokenVersion: string
): HmrIterationExpectation[] {
  return probePlan.map((entry) => ({
    scriptPath: entry.scriptPath,
    expectedToken: `${entry.probeId}:${tokenVersion}`
  }))
}

export function extractUpdatedHtmlFromNdjson(output: string): string[] {
  if (!output.trim()) return []

  const htmls: string[] = []
  const lines = output.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('{')) continue

    try {
      const parsed = JSON.parse(trimmed) as {
        type?: string
        stage?: string
        html?: string
      }
      if (
        parsed.type === 'page_html' &&
        parsed.stage === 'updated' &&
        typeof parsed.html === 'string'
      ) {
        htmls.push(parsed.html)
      }
    } catch {
      // Ignore non-JSON lines and truncated lines in mixed output streams.
    }
  }

  return htmls
}

export function evaluateDeterministicHmrIterations(
  expectations: HmrIterationExpectation[],
  updatedHtmlSnapshots: string[]
): HmrIterationResult[] {
  return expectations.map((expectation, index) => {
    const html = updatedHtmlSnapshots[index]

    if (typeof html !== 'string') {
      return {
        scriptPath: expectation.scriptPath,
        expectedToken: expectation.expectedToken,
        snapshotIndex: index,
        passed: false,
        reason: 'missing updated snapshot for iteration'
      }
    }

    const passed = html.includes(expectation.expectedToken)
    return {
      scriptPath: expectation.scriptPath,
      expectedToken: expectation.expectedToken,
      snapshotIndex: index,
      passed,
      reason: passed
        ? 'token found in updated snapshot'
        : 'expected token not found in updated snapshot'
    }
  })
}

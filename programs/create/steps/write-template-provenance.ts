//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {readFileSync} from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as messages from '../lib/messages'
import type {TemplateProvenance} from './import-external-template'

// A scaffold drops this so the project records exactly which template corpus it
// came from; downstream creators pin the same ref, so divergence is auditable.
export const TEMPLATE_PROVENANCE_FILE = '.extension-create.json'

// extension-create publishes in lockstep with the engine; stamp our own version
// so a project can tell which create cut it.
function ownCreateVersion(): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    )
    return typeof pkg.version === 'string' && pkg.version
      ? `extension-create@${pkg.version}`
      : undefined
  } catch {
    return undefined
  }
}

export function buildProvenanceRecord(
  provenance: TemplateProvenance
): Record<string, string> {
  return {
    ...(ownCreateVersion() ? {createdWith: ownCreateVersion() as string} : {}),
    template: provenance.template,
    source: provenance.source,
    ...(provenance.ref ? {ref: provenance.ref} : {})
  }
}

export async function writeTemplateProvenance(
  projectPath: string,
  provenance: TemplateProvenance,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
): Promise<void> {
  // Advisory: a caller with no resolved provenance (or a mock) never crashes create.
  if (!provenance?.template) return
  const record = buildProvenanceRecord(provenance)
  try {
    logger.log(messages.writingTemplateProvenance())
    await fs.writeFile(
      path.join(projectPath, TEMPLATE_PROVENANCE_FILE),
      `${JSON.stringify(record, null, 2)}\n`
    )
  } catch (error) {
    // Provenance is advisory: warn but never fail an otherwise-good scaffold.
    logger.error(messages.writingTemplateProvenanceError(error))
  }
}

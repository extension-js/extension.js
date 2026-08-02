//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as messages from '../lib/messages'
import {isDebug} from '../lib/messaging'

export const STORE_METADATA_FILE = 'STORE.md'

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A token no template prose can contain (NUL delimited), so renaming happens
// in one logical pass: a name written by one step is never re-matched later.
const NAME_PLACEHOLDER = '\u0000extension-create-name\u0000'

export function rewriteStoreMetadata(
  content: string,
  projectName: string,
  templateName: string,
  today: string
): string {
  let next = content

  // Retire the template name everywhere BEFORE the project name is inserted
  // anywhere, so a project name extending the template name ("New Tab" ->
  // "New Tab Pro") is written once and never doubled.
  if (templateName && templateName !== projectName) {
    next = next.replace(
      new RegExp(escapeForRegExp(templateName), 'g'),
      NAME_PLACEHOLDER
    )
  }

  next = next.replace(
    /^(\s*-\s*Name:).*$/m,
    (_match, label: string) => `${label} ${NAME_PLACEHOLDER}`
  )

  next = next.replace(
    /^(Last updated:).*$/m,
    (_match, label: string) => `${label} ${today}`
  )

  return next.split(NAME_PLACEHOLDER).join(projectName)
}

/* @invariant STORE.md is the copy a person pastes into a store listing, so it
 * names the extension it ships beside and never the template it was cut from.
 * The same defect shipped a wrapper template's name to a customer's reviewer. */
export async function writeStoreMetadata(
  projectPath: string,
  projectName: string,
  templateName: string,
  logger: {log(...args: unknown[]): void; error(...args: unknown[]): void}
): Promise<void> {
  const storePath = path.join(projectPath, STORE_METADATA_FILE)

  let content: string
  try {
    content = await fs.readFile(storePath, 'utf8')
  } catch {
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  const rewritten = rewriteStoreMetadata(
    content,
    projectName,
    templateName,
    today
  )

  if (rewritten === content) return

  try {
    if (isDebug()) logger.log(messages.writingStoreMetadata(projectName))
    await fs.writeFile(storePath, rewritten)
  } catch (error) {
    logger.error(messages.writingStoreMetadataError(error))
  }
}

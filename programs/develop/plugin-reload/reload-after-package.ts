// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  formatReloadContextLabel,
  type ReloadInstruction
} from './classify-reload'

function union(
  previous: string[] | undefined,
  next: string[] | undefined
): string[] {
  return [...new Set([...(previous || []), ...(next || [])])].sort()
}

// A package replaces the extension under a running browser and restarts it,
// so only what a restart cannot deliver is kept: content scripts in open tabs.
export function reloadSurvivingPackage(
  instruction: ReloadInstruction | undefined
): ReloadInstruction | undefined {
  if (!instruction) return undefined

  // 'page' is notify-only, it restarts nothing and carries the announcement.
  if (instruction.type === 'content-scripts' || instruction.type === 'page') {
    return instruction
  }

  const entries = instruction.changedContentScriptEntries || []
  if (entries.length === 0) return undefined

  // A source shared by the background and a content script. The restart covers
  // the background half, the open tabs still need the new content code.
  return {
    ...instruction,
    type: 'content-scripts',
    label: formatReloadContextLabel(
      'content_script',
      instruction.changedAssets || []
    )
  }
}

// A save burst collapses to one package, so its reloads collapse to one frame.
// Entries union, since every content entry it touched must reach its tabs.
export function mergeReloadInstructions(
  previous: ReloadInstruction | undefined,
  next: ReloadInstruction | undefined
): ReloadInstruction | undefined {
  if (!previous) return next
  if (!next) return previous

  const entries = union(
    previous.changedContentScriptEntries,
    next.changedContentScriptEntries
  )
  const scriptFiles = union(
    previous.changedScriptFiles,
    next.changedScriptFiles
  )

  if (entries.length === 0) {
    return scriptFiles.length > 0
      ? {...next, changedScriptFiles: scriptFiles}
      : next
  }

  // Keep the newest instruction that names content work, so the label points at
  // a content edit rather than at a page edit that rode along with it.
  const base = next.type === 'content-scripts' ? next : previous

  return {
    ...base,
    changedContentScriptEntries: entries,
    ...(scriptFiles.length > 0 ? {changedScriptFiles: scriptFiles} : {})
  }
}

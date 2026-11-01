// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {SafariBuildConfig} from '../safari-types'

// What codesign says about the app on disk, which is the only signature Safari
// sees. The configuration says what was asked for, and the two differ the
// moment Xcode has no account for the team it was asked to sign with.
export interface SafariCodeSignature {
  // False for an ad-hoc signature and for an app codesign could not read.
  signed: boolean
  team: string | null
}

export const ADHOC_SIGNATURE = 'adhoc'

// `codesign -dv --verbose=2 <app>` prints `key=value` rows on stderr. An
// ad-hoc build carries `Signature=adhoc` and `TeamIdentifier=not set`, a
// team-signed one carries the ten-character team id.
export function parseCodeSignature(output: string): SafariCodeSignature {
  const rows = new Map<string, string>()

  for (const line of output.split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at <= 0) continue

    rows.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }

  const team = rows.get('TeamIdentifier') || ''
  const adhoc =
    rows.get('Signature') === 'adhoc' || !team || /^not set$/i.test(team)

  if (adhoc) return {signed: false, team: null}

  return {signed: true, team}
}

// The one word the signature record keeps: `adhoc`, or the team id.
export function signatureKey(signature: SafariCodeSignature): string {
  return signature.signed && signature.team ? signature.team : ADHOC_SIGNATURE
}

export function describeSignature(key: string | null): string {
  return !key || key === ADHOC_SIGNATURE ? 'ad-hoc' : `team ${key}`
}

// xcodebuild names the team it could not sign for on one line of its output,
// on success and on failure alike. That line is the cause the user has to
// act on, and it drowns in the tail unless something fishes it out.
export function noAccountForTeam(output: string): string | null {
  const hit = /No Account for Team\s+"?([A-Za-z0-9]+)"?/i.exec(output)

  return hit ? hit[1] : null
}

export interface XcodeTeam {
  id: string
  name: string | null
}

// Xcode keeps the teams of every signed-in Apple ID in its defaults
// (IDEProvisioningTeamByIdentifier on Xcode 26, IDEProvisioningTeams before),
// as plist text when read with `defaults read`. Each team row carries teamID and teamName. Anything that
// does not parse yields no team, never an error, because this listing only
// decorates a remedy.
export function parseXcodeTeams(output: string): XcodeTeam[] {
  const teams = new Map<string, XcodeTeam>()

  // Every team is one `{ ... }` block holding both rows.
  for (const block of output.split('{')) {
    const id = /teamID\s*=\s*"?([A-Za-z0-9]+)"?\s*;/.exec(block)
    if (!id || teams.has(id[1])) continue

    const name = /teamName\s*=\s*"?([^";]*)"?\s*;/.exec(block)

    teams.set(id[1], {id: id[1], name: name?.[1].trim() || null})
  }

  return [...teams.values()]
}

export function signatureRecordPath(config: SafariBuildConfig): string {
  return path.join(config.projectLocation, '.signature')
}

export function readSignatureRecord(config: SafariBuildConfig): string | null {
  try {
    const stored = fs.readFileSync(signatureRecordPath(config), 'utf8').trim()

    return stored || null
  } catch {
    return null
  }
}

export function saveSignatureRecord(
  config: SafariBuildConfig,
  signature: SafariCodeSignature
): void {
  fs.mkdirSync(path.dirname(signatureRecordPath(config)), {recursive: true})
  fs.writeFileSync(signatureRecordPath(config), signatureKey(signature), 'utf8')
}

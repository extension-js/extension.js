// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {readyContractPath} from './session-paths'

export interface LiveDevSession {
  distPath: string
  pid: number
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

// A dev session owns ready.json while its producer lives. A stopped, errored
// or orphaned contract belongs to nobody, so a build may replace it.
export function findLiveDevSession(
  projectPath: string,
  browser: string
): LiveDevSession | null {
  let contract: Record<string, unknown>

  try {
    contract = JSON.parse(
      fs.readFileSync(readyContractPath(projectPath, browser), 'utf-8')
    )
  } catch {
    return null
  }

  if (!contract || typeof contract !== 'object') return null
  if (contract.command !== 'dev') return null
  if (contract.status !== 'starting' && contract.status !== 'ready') return null

  const pid = Number(contract.pid)

  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null
  if (!isProcessAlive(pid)) return null

  const distPath =
    typeof contract.distPath === 'string' && contract.distPath
      ? path.resolve(contract.distPath)
      : ''

  return {distPath, pid}
}

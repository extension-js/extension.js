// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as nodePath from 'node:path'
import {holdsForeignFiles, protectedFolderAt} from '../lib/build-output-guard'
import {codedError} from '../lib/coded-error'
import {findLiveDevSession} from '../lib/live-dev-session'
import * as messages from '../lib/messages'
import {CODES} from '../lib/messaging'
import {displayPath} from '../lib/paths'
import {isSameOrInsidePath, isSamePath} from '../lib/real-path'
import {browserDistDir} from '../lib/session-paths'

// The build retires and deletes whatever sits at <outDir>/<browser>, so the
// folder is checked before anything is written or removed.
export function resolveOutDir(
  raw: unknown,
  packageJsonDir: string,
  browser: string
): string | undefined {
  if (raw === undefined || raw === null) return undefined

  if (typeof raw !== 'string' || !raw.trim()) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(String(raw), 'project-root')
    )
  }

  const value = raw.trim()
  const base = nodePath.resolve(packageJsonDir, value)

  if (isSamePath(base, packageJsonDir)) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(raw, 'project-root')
    )
  }

  const target = nodePath.join(base, browser)
  const baseRefusal = protectedFolderAt(base, packageJsonDir, {
    cwd: false,
    replaced: false
  })

  if (baseRefusal) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(value, baseRefusal, base)
    )
  }

  const targetRefusal = protectedFolderAt(target, packageJsonDir)

  if (targetRefusal) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(value, targetRefusal, target)
    )
  }

  if (holdsForeignFiles(target)) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(
        value,
        'not-a-build',
        target,
        isSameOrInsidePath(packageJsonDir, target) ? 'inside' : 'outside'
      )
    )
  }

  return value
}

// A relative folder stays inside the project, and an absolute one is taken
// as meant. The browser folder ships whole, so no archive may sit in it.
export function resolveZipDir(
  raw: unknown,
  packageJsonDir: string,
  distPath: string
): string | undefined {
  if (raw === undefined || raw === null) return undefined

  if (typeof raw !== 'string' || !raw.trim()) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildZipDirInvalid(String(raw), 'empty')
    )
  }

  const value = raw.trim()
  const resolved = nodePath.resolve(packageJsonDir, value)
  const fromProject = nodePath.relative(packageJsonDir, resolved)

  if (
    !nodePath.isAbsolute(value) &&
    (fromProject === '..' ||
      fromProject.startsWith(`..${nodePath.sep}`) ||
      nodePath.isAbsolute(fromProject))
  ) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildZipDirInvalid(value, 'outside', resolved)
    )
  }

  const fromDist = nodePath.relative(distPath, resolved)

  if (
    fromDist === '' ||
    (!fromDist.startsWith('..') && !nodePath.isAbsolute(fromDist))
  ) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildZipDirInvalid(value, 'inside-build')
    )
  }

  return resolved
}

// The stock folder is replaced under the rule an asked one follows.
export function refuseForeignOutputFolder(
  outDir: string | undefined,
  distPath: string
): void {
  if (!outDir && holdsForeignFiles(distPath)) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutputFolderForeign(distPath)
    )
  }
}

// A live dev session owns dist/<browser> the way a second dev session
// learns it does: the files under it are what the browser is running, and
// a production bundle written over them pulls the dev stubs and the control
// file out from under that browser with no word to its owner. So the build
// is refused, and --out-dir is the way to build beside the session. A build
// elsewhere still leaves the session's ready.json and events alone.
export function refuseBuildOverLiveSession(
  packageJsonDir: string,
  browser: string,
  distPath: string
) {
  const liveDevSession = findLiveDevSession(packageJsonDir, browser)

  if (
    liveDevSession &&
    isSamePath(
      liveDevSession.distPath || browserDistDir(packageJsonDir, browser),
      distPath
    )
  ) {
    throw codedError(
      CODES.E_DEV_SESSION_DIST_SHARED,
      messages.buildSharesDevDist(
        browser,
        displayPath(distPath),
        liveDevSession.pid
      )
    )
  }

  return liveDevSession
}

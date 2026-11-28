import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  readyContractPath,
  SESSION_ARTIFACT_FILES,
  SESSION_ARTIFACTS_DIR,
  sessionArtifactsRootDir
} from '../session-contract'
import {
  actionsPath,
  buildSummaryPath,
  eventsPath,
  legacyControlPortFilePath,
  logsPath
} from '../session-paths'

// The packager leaves out exactly the listed names, so a session file
// written under a name the list lacks would ship inside an archive.
describe('session artifact names', () => {
  it('lists every file a session path helper names', () => {
    const written = [
      readyContractPath,
      eventsPath,
      logsPath,
      actionsPath,
      buildSummaryPath,
      legacyControlPortFilePath
    ].map((pathOf) => path.basename(pathOf('/p', 'chrome')))

    expect([...SESSION_ARTIFACT_FILES].sort()).toEqual([...written].sort())
  })

  it('names the folder the session root sits in', () => {
    expect(path.basename(sessionArtifactsRootDir('/p'))).toBe(
      SESSION_ARTIFACTS_DIR
    )
  })
})

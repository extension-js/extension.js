import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {readManifestJson, readTemplatePackageJson} from '../find-manifest-json'

// Node's parse message quotes the start of the file, and a template file that
// links to another file relayed that file in the refusal.
const SECRET = 'root:x:0:0:secret-hunter2'

function expectNoSecret(text: string) {
  for (let i = 0; i + 4 <= SECRET.length; i++) {
    expect(text).not.toContain(SECRET.slice(i, i + 4))
  }
}

async function refusal(
  read: () => unknown
): Promise<Error & {cause?: unknown}> {
  try {
    await read()
  } catch (error) {
    return error as Error & {cause?: unknown}
  }

  throw new Error('the read did not refuse')
}

describe('a template file whose text is not JSON', () => {
  let projectPath = ''

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-create-leak-'))
  })

  afterEach(() => {
    fs.rmSync(projectPath, {recursive: true, force: true})
  })

  it.each([
    ['manifest.json', () => readManifestJson(projectPath)],
    ['package.json', () => readTemplatePackageJson(projectPath)]
  ])('refuses %s with the line and column and none of its text', async (file, read) => {
    fs.writeFileSync(path.join(projectPath, file), SECRET)

    const error = await refusal(read)

    expect(error.message).toContain('unexpected character at line 1 column 1')
    expectNoSecret(error.message)
    expectNoSecret(String((error.cause as Error | undefined)?.message))
  })
})

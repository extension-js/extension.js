//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {Command} from 'commander'
import {exitAfterDrain} from '../helpers/exit-after-drain'
import {commandDescriptions} from '../helpers/messages'
import {CODES, ENVELOPE, type EnvelopeError} from '../helpers/messaging'

// THIN WRAPPER, keep it that way: build a request, POST it, print the URL.
// The canonical publish implementation lives in the extension.dev platform MCP.
const DEFAULT_API = 'https://www.extension.dev'
const PUBLISH_DOCS_URL = 'https://docs.extension.dev/tools/publish'
const NO_TOKEN_REMEDY =
  'Pass --token, set EXTENSION_DEV_TOKEN, or run npx @extension.dev/mcp login.'

// Where `npx @extension.dev/mcp login` stores the device login. This mirrors
// the MCP's credentialsPath so both surfaces read the same file.
function storedLoginPath(): string {
  if (process.platform === 'win32') {
    const base =
      process.env.APPDATA ||
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(base, 'extension-dev', 'auth.json')
  }
  const xdg = String(process.env.XDG_CONFIG_HOME || '').trim()
  const base = xdg || path.join(os.homedir(), '.config')
  return path.join(base, 'extension-dev', 'auth.json')
}

export interface StoredLogin {
  token: string
  projectSlug: string
  workspaceSlug: string
}

// Read the stored device login, matching the MCP's readValidCredentials. A
// missing, malformed, or expired file yields null and the no-token refusal.
export function readStoredLogin(): StoredLogin | null {
  try {
    const raw = fs.readFileSync(storedLoginPath(), 'utf8')
    const data = JSON.parse(raw) as {
      version?: unknown
      token?: unknown
      expiresAt?: unknown
      projectSlug?: unknown
      workspaceSlug?: unknown
    } | null
    if (!data || typeof data !== 'object') return null
    if (data.version !== 1) return null
    const token = String(data.token || '').trim()
    if (!token) return null
    const expiresAt = Number(data.expiresAt || 0)
    if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000)) return null
    return {
      token,
      projectSlug: String(data.projectSlug || '').trim(),
      workspaceSlug: String(data.workspaceSlug || '').trim()
    }
  } catch {
    return null
  }
}

export function readStoredLoginToken(): string {
  return readStoredLogin()?.token || ''
}

// The name this directory calls itself, in the order the tool trusts: the
// package manifest, then the extension manifest, then the folder itself.
export function readLocalProjectName(projectPath: string): string {
  const fromJson = (file: string): string => {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        name?: unknown
      }
      return String(data?.name || '').trim()
    } catch {
      return ''
    }
  }

  return (
    fromJson(path.join(projectPath, 'package.json')) ||
    fromJson(path.join(projectPath, 'manifest.json')) ||
    fromJson(path.join(projectPath, 'src', 'manifest.json')) ||
    path.basename(path.resolve(projectPath))
  )
}

// Slugs and directory names are written by different hands, so compare on the
// shape a slug survives: lowercase, non-alphanumerics collapsed.
function slugish(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface PublishRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface PublishInput {
  token?: string
  api?: string
  ttl?: string | number
  buildSha?: string
  projectPath?: string
  project?: string
}

/**
 * The project this publish will act for, and where that answer came from. A
 * stored login is scoped to one project, so a publish run anywhere else answers
 * for the wrong one; `actsFor` is what the command prints and refuses on.
 */
export interface PublishScope {
  source: 'flag' | 'env' | 'stored-login'
  actsFor: string
  workspace: string
  localName: string
}

/** Build the HTTP request (pure, unit-testable, no network). */
export function buildPublishRequest(opts: PublishInput): PublishRequest {
  return buildPublishPlan(opts).request
}

export function buildPublishPlan(opts: PublishInput): {
  request: PublishRequest
  scope: PublishScope
} {
  // Precedence matches the MCP's resolveToken: the flag wins, then the env
  // var, then the stored device login written by npx @extension.dev/mcp login.
  const stored = readStoredLogin()
  const flagToken = String(opts.token || '').trim()
  const envToken = String(process.env.EXTENSION_DEV_TOKEN || '').trim()
  const token = flagToken || envToken || stored?.token || ''
  const source: PublishScope['source'] = flagToken
    ? 'flag'
    : envToken
      ? 'env'
      : 'stored-login'

  if (!token) {
    throw new Error(
      'No token. Publishing needs an extension.dev access token.\n' +
        `Get one: ${PUBLISH_DOCS_URL}\n` +
        NO_TOKEN_REMEDY
    )
  }

  const projectPath = path.resolve(opts.projectPath || process.cwd())
  const localName = readLocalProjectName(projectPath)
  const confirmed = String(opts.project || '').trim()
  const scopedSlug = source === 'stored-login' ? stored?.projectSlug || '' : ''

  // A stored login carries its own project. Publishing from somewhere else
  // would mint a share for that project and name it nowhere but inside the URL,
  // so the mismatch is a refusal, not a warning.
  if (confirmed && scopedSlug && slugish(confirmed) !== slugish(scopedSlug)) {
    throw new Error(
      `You asked to publish "${confirmed}" but your stored login is scoped to "${scopedSlug}".\n` +
        `Pass --token for ${confirmed}, or run npx @extension.dev/mcp login for it.`
    )
  }

  if (
    scopedSlug &&
    slugish(scopedSlug) !== slugish(localName) &&
    slugish(confirmed) !== slugish(scopedSlug)
  ) {
    throw new Error(
      `Your stored login is scoped to the "${scopedSlug}" project` +
        `${stored?.workspaceSlug ? ` in workspace "${stored.workspaceSlug}"` : ''}, ` +
        `but ${projectPath} is "${localName}".\n` +
        `Publishing here would share ${scopedSlug}, not ${localName}.\n` +
        `Run extension publish inside ${scopedSlug}, pass --project ${scopedSlug} to publish that project on purpose, ` +
        'or pass --token / EXTENSION_DEV_TOKEN for this one.'
    )
  }

  const base = String(
    opts.api || process.env.EXTENSION_DEV_API_URL || DEFAULT_API
  ).replace(/\/+$/, '')
  const body: Record<string, unknown> = {}

  if (opts.ttl != null && opts.ttl !== '') body.ttlHours = Number(opts.ttl)
  if (opts.buildSha) body.buildSha = opts.buildSha

  return {
    request: {
      url: `${base}/api/cli/publish`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    scope: {
      source,
      actsFor: scopedSlug || confirmed || localName,
      workspace: source === 'stored-login' ? stored?.workspaceSlug || '' : '',
      localName
    }
  }
}

type PublishOptions = PublishInput & {output?: 'pretty' | 'json'}

export function registerPublishCommand(program: Command) {
  program
    .command('publish')
    .arguments('[project-path]')
    .usage('[project-path] [options]')
    .description(commandDescriptions.publish)
    .option(
      '--token <token>',
      'extension.dev access token (or EXTENSION_DEV_TOKEN, or the stored login)'
    )
    .option('--api <url>', 'platform base URL (or EXTENSION_DEV_API_URL)')
    .option('--ttl <hours>', 'share-link lifetime in hours (1–168, default 24)')
    .option('--build-sha <sha>', 'pin the share URL to a specific build')
    .option(
      '--project <slug>',
      'name the project this publish is for, when it is not the directory you are in'
    )
    .option('--output <pretty|json>', 'output format (default pretty)')
    .action(async (projectPathArg: string, opts: PublishOptions) => {
      const asJson = opts.output === 'json'

      // One exit path for every refusal: json gets the envelope, pretty keeps
      // the prose it already printed.
      const failWith = async (
        status: string,
        error: EnvelopeError,
        prose: string,
        hint?: string
      ) => {
        if (asJson) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              ENVELOPE.fail('publish', status, error, hint ? {hint} : {})
            )
          )
        } else {
          // eslint-disable-next-line no-console
          console.error(prose)
        }
        await exitAfterDrain(1)
      }

      let req: PublishRequest
      let scope: PublishScope
      try {
        const plan = buildPublishPlan({...opts, projectPath: projectPathArg})
        req = plan.request
        scope = plan.scope
      } catch (err) {
        const message =
          (err as Error | undefined)?.message || 'publish failed: no token'
        await failWith(
          'denied',
          {code: CODES.E_AUTH_REQUIRED, message},
          message,
          `Get a token at ${PUBLISH_DOCS_URL}. ${NO_TOKEN_REMEDY}`
        )
        return
      }

      let res: Response
      try {
        res = await fetch(req.url, {
          method: 'POST',
          headers: req.headers,
          body: req.body
        })
      } catch (err) {
        const detail = (err as Error | undefined)?.message || String(err)
        const message = `Could not reach ${req.url}: ${detail}`
        await failWith(
          'failed',
          {code: CODES.E_NETWORK, message},
          message,
          'Check your network, or point --api at a reachable host.'
        )
        return
      }

      const text = await res.text()
      let data: {message?: unknown; shareUrl?: unknown}

      try {
        data = JSON.parse(text)
      } catch {
        data = {message: text}
      }

      if (!res.ok) {
        const message = `publish failed (${res.status}): ${data?.message || text || 'unknown error'}`
        await failWith(
          'rejected',
          {code: CODES.E_PUBLISH_REJECTED, message},
          message
        )
        return
      }

      if (asJson) {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            ENVELOPE.ok('publish', 'published', {
              ...data,
              project: scope.actsFor,
              workspace: scope.workspace || undefined,
              tokenSource: scope.source
            })
          )
        )
      } else {
        // The share URL is the payload and stays alone on stdout so a pipe
        // still receives only the link; naming the project is diagnostics.
        // eslint-disable-next-line no-console
        console.error(
          `Published ${scope.actsFor}${scope.workspace ? ` (workspace ${scope.workspace})` : ''}:`
        )
        // eslint-disable-next-line no-console
        console.log(data.shareUrl || JSON.stringify(data))
      }
      await exitAfterDrain(0)
    })
}

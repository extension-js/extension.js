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

// Read the stored device login, matching the MCP's readValidCredentials. A
// missing, malformed, or expired file yields '' and the no-token refusal.
export function readStoredLoginToken(): string {
  try {
    const raw = fs.readFileSync(storedLoginPath(), 'utf8')
    const data = JSON.parse(raw) as {
      version?: unknown
      token?: unknown
      expiresAt?: unknown
    } | null
    if (!data || typeof data !== 'object') return ''
    if (data.version !== 1) return ''
    const token = String(data.token || '').trim()
    if (!token) return ''
    const expiresAt = Number(data.expiresAt || 0)
    if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000)) return ''
    return token
  } catch {
    return ''
  }
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
}

/** Build the HTTP request (pure, unit-testable, no network). */
export function buildPublishRequest(opts: PublishInput): PublishRequest {
  // Precedence matches the MCP's resolveToken: the flag wins, then the env
  // var, then the stored device login written by npx @extension.dev/mcp login.
  const token = String(
    opts.token || process.env.EXTENSION_DEV_TOKEN || readStoredLoginToken()
  ).trim()

  if (!token) {
    throw new Error(
      'No token. Publishing needs an extension.dev access token.\n' +
        `Get one: ${PUBLISH_DOCS_URL}\n` +
        NO_TOKEN_REMEDY
    )
  }

  const base = String(
    opts.api || process.env.EXTENSION_DEV_API_URL || DEFAULT_API
  ).replace(/\/+$/, '')
  const body: Record<string, unknown> = {}

  if (opts.ttl != null && opts.ttl !== '') body.ttlHours = Number(opts.ttl)
  if (opts.buildSha) body.buildSha = opts.buildSha

  return {
    url: `${base}/api/cli/publish`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
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
    .option('--output <pretty|json>', 'output format (default pretty)')
    .action(async (_projectPathArg: string, opts: PublishOptions) => {
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
      try {
        req = buildPublishRequest(opts)
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
        console.log(JSON.stringify(ENVELOPE.ok('publish', 'published', data)))
      } else {
        // eslint-disable-next-line no-console
        console.log(data.shareUrl || JSON.stringify(data))
      }
      await exitAfterDrain(0)
    })
}

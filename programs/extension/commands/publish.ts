//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

// Platform track (auth-gated): `extension publish` posts to the extension.dev
// CLI publish endpoint (POST /api/cli/publish) with a Bearer workspace/project
// access token and returns a shareable URL for the project. This talks to the
// hosted platform — NOT the local agent-bridge control WS — so it needs an
// account token (EXTENSION_DEV_TOKEN), the only auth the toolchain imposes.

import type {Command} from 'commander'

const DEFAULT_API = 'https://www.extension.dev'

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

/** Build the HTTP request (pure, unit-testable — no network). */
export function buildPublishRequest(opts: PublishInput): PublishRequest {
  const token = String(opts.token || process.env.EXTENSION_DEV_TOKEN || '').trim()
  if (!token) {
    throw new Error(
      'No token. Set EXTENSION_DEV_TOKEN (create one in the extension.dev ' +
        'dashboard, or via the project access-tokens API) or pass --token.'
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
    .usage('publish [project-path] [options]')
    .description(
      'Publish to extension.dev and print a shareable URL (requires EXTENSION_DEV_TOKEN)'
    )
    .option('--token <token>', 'extension.dev access token (or EXTENSION_DEV_TOKEN)')
    .option('--api <url>', 'platform base URL (or EXTENSION_DEV_API_URL)')
    .option('--ttl <hours>', 'share-link lifetime in hours (1–168, default 24)')
    .option('--build-sha <sha>', 'pin the share URL to a specific build')
    .option('--output <pretty|json>', 'output format (default pretty)')
    .action(async function (_projectPathArg: string, opts: PublishOptions) {
      let req: PublishRequest
      try {
        req = buildPublishRequest(opts)
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(err?.message || 'publish failed')
        process.exit(1)
      }

      let res: Response
      try {
        res = await fetch(req.url, {
          method: 'POST',
          headers: req.headers,
          body: req.body
        })
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error(`Could not reach ${req.url}: ${err?.message || err}`)
        process.exit(1)
      }

      const text = await res.text()
      let data: any
      try {
        data = JSON.parse(text)
      } catch {
        data = {message: text}
      }

      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error(
          `publish failed (${res.status}): ${data?.message || text || 'unknown error'}`
        )
        process.exit(1)
      }

      if (opts.output === 'json') {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(data))
      } else {
        // eslint-disable-next-line no-console
        console.log(data.shareUrl || JSON.stringify(data))
      }
      process.exit(0)
    })
}

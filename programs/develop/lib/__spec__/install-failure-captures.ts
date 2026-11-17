export const CAPTURED_INSTALL_FAILURES: Record<string, string> = {
  'bun-auth': [
    'bun install v1.4.4 (38afee6c8)',
    'Resolving dependencies',
    'Resolved, downloaded and extracted [1]',
    'error: GET http://registry.test/stubx-dep - 401',
    'error: stubx-dep@^1.0.0 failed to resolve'
  ].join('\n'),
  'bun-missing-package': [
    'bun install v1.4.4 (38afee6c8)',
    'Resolving dependencies',
    'Resolved, downloaded and extracted [1]',
    'error: GET http://registry.test/stubx-nope - 404',
    'error: stubx-nope@^1.0.0 failed to resolve'
  ].join('\n'),
  'bun-tarball-404': [
    'bun install v1.4.4 (38afee6c8)',
    'Resolving dependencies',
    'Resolved, downloaded and extracted [3]',
    'error: GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz - 404'
  ].join('\n'),
  'bun-tarball-503': [
    'bun install v1.4.4 (38afee6c8)',
    'Resolving dependencies',
    'Resolved, downloaded and extracted [8]',
    'error: GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz - 503'
  ].join('\n'),
  'bun-tarball-reset': [
    'bun install v1.4.4 (38afee6c8)',
    'Resolving dependencies',
    'Resolved, downloaded and extracted [8]',
    'error: ConnectionClosed downloading tarball stubx-dep@1.0.1'
  ].join('\n'),
  'bun-version-direct': [
    'bun install v1.4.4 (38afee6c8)',
    'Resolving dependencies',
    'Resolved, downloaded and extracted [2]',
    'error: No version matching "^9.0.0" found for specifier "stubx-late" (but package exists)',
    'error: stubx-late@^9.0.0 failed to resolve'
  ].join('\n'),
  'bun-version-transitive': [
    'bun install v1.4.4 (38afee6c8)',
    'Resolving dependencies',
    'Resolved, downloaded and extracted [6]',
    'error: No version matching "^4.0.3" found for specifier "stubx-late" (but package exists)',
    'error: stubx-late@^4.0.3 failed to resolve'
  ].join('\n'),
  'deno-age-direct': [
    'Download http://registry.test/stubx-late',
    "error: Could not find npm package 'stubx-late' matching '^4.0.3'.",
    '',
    'A newer matching version was found, but it was not used because it was newer than the specified minimum dependency date of 2026-11-16 15:02:14.701983 UTC.',
    '',
    'hint: This version is blocked by the minimum dependency age policy, which avoids installing recently published versions to reduce supply chain risk (the default is 24 hours). To use this version now, pass the --minimum-dependency-age (or --min-dep-age) flag (for example 0 to disable it, or a shorter duration like 60 minutes) or set "minimumDependencyAge" in your deno.json, or wait until the version is old enough.',
    'docs: https://docs.deno.com/go/minimum-dependency-age'
  ].join('\n'),
  'deno-age-transitive': [
    'Download http://registry.test/stubx-parent',
    'Download http://registry.test/stubx-late',
    "error: Could not find npm package 'stubx-late' matching '^4.0.3'.",
    '',
    'A newer matching version was found, but it was not used because it was newer than the specified minimum dependency date of 2026-11-16 15:02:14.854416 UTC.',
    '',
    'hint: This version is blocked by the minimum dependency age policy, which avoids installing recently published versions to reduce supply chain risk (the default is 24 hours). To use this version now, pass the --minimum-dependency-age (or --min-dep-age) flag (for example 0 to disable it, or a shorter duration like 60 minutes) or set "minimumDependencyAge" in your deno.json, or wait until the version is old enough.',
    'docs: https://docs.deno.com/go/minimum-dependency-age'
  ].join('\n'),
  'deno-auth': [
    'Download http://registry.test/stubx-dep',
    'error: Failed loading http://registry.test/stubx-dep for package "stubx-dep"',
    '',
    'Caused by:',
    '    Bad response: 401',
    '    ',
    '    {"error":"Unauthorized"}'
  ].join('\n'),
  'deno-missing-package': [
    'Download http://registry.test/stubx-nope',
    "error: npm package 'stubx-nope' does not exist."
  ].join('\n'),
  'deno-tarball-404': [
    'Download http://registry.test/stubx-dep',
    'Download http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz',
    "error: Failed caching npm package 'stubx-dep@1.0.1'",
    '',
    'Caused by:',
    '    Could not find npm package tarball at: http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz'
  ].join('\n'),
  'deno-tarball-503': [
    'Download http://registry.test/stubx-dep',
    'Download http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz',
    "error: Failed caching npm package 'stubx-dep@1.0.1'",
    '',
    'Caused by:',
    '    Bad response: 503',
    '    ',
    '    {"error":"Service Unavailable"}'
  ].join('\n'),
  'deno-tarball-reset': [
    'Download http://registry.test/stubx-dep',
    'Download http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz',
    "error: Failed caching npm package 'stubx-dep@1.0.1'",
    '',
    'Caused by:',
    '    0: error sending request from registry.test for http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz (registry.test): client error (SendRequest): connection closed before message completed',
    '    1: client error (SendRequest)',
    '    2: connection closed before message completed'
  ].join('\n'),
  'deno-version-direct': [
    'Download http://registry.test/stubx-late',
    "error: Could not find npm package 'stubx-late' matching '^9.0.0'."
  ].join('\n'),
  'deno-version-transitive': [
    'Download http://registry.test/stubx-parent',
    'Download http://registry.test/stubx-late',
    "error: Could not find npm package 'stubx-late' matching '^4.0.3'."
  ].join('\n'),
  'npm-auth': [
    'npm error code E401',
    'npm error 401 Unauthorized - GET http://registry.test/stubx-dep - Unauthorized'
  ].join('\n'),
  'npm-missing-package': [
    'npm error code E404',
    'npm error 404 Not Found - GET http://registry.test/stubx-nope - Not found',
    'npm error 404',
    "npm error 404  The requested resource 'stubx-nope@^1.0.0' could not be found or you do not have permission to access it.",
    'npm error 404',
    'npm error 404 Note that you can also install from a',
    'npm error 404 tarball, folder, http url, or git url.'
  ].join('\n'),
  'npm-tarball-404': [
    'npm error code E404',
    'npm error 404 Not Found - GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz - Not Found',
    'npm error 404',
    "npm error 404  The requested resource 'stubx-dep@http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz' could not be found or you do not have permission to access it.",
    'npm error 404',
    'npm error 404 Note that you can also install from a',
    'npm error 404 tarball, folder, http url, or git url.'
  ].join('\n'),
  'npm-tarball-503': [
    'npm error code E503',
    'npm error 503 Service Unavailable - GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz - Service Unavailable'
  ].join('\n'),
  'npm-tarball-reset': [
    'npm error code ECONNRESET',
    'npm error errno ECONNRESET',
    'npm error network request to http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz failed, reason: socket hang up',
    'npm error network This is a problem related to network connectivity.',
    'npm error network In most cases you are behind a proxy or have bad network settings.',
    'npm error network',
    "npm error network If you are behind a proxy, please make sure that the 'proxy' config is set properly.  See: 'npm help config'"
  ].join('\n'),
  'npm-version-direct': [
    'npm error code ETARGET',
    'npm error notarget No matching version found for stubx-late@^9.0.0.',
    "npm error notarget In most cases you or one of your dependencies are requesting a package version that doesn't exist."
  ].join('\n'),
  'npm-version-transitive': [
    'npm error code ETARGET',
    'npm error notarget No matching version found for stubx-late@^4.0.3.',
    "npm error notarget In most cases you or one of your dependencies are requesting a package version that doesn't exist."
  ].join('\n'),
  'pnpm-age-direct': [
    'Progress: resolved 0, reused 0, downloaded 1, added 0',
    'Error: ERR_PNPM_NO_MATURE_MATCHING_VERSION',
    '',
    '  × installing dependencies',
    '  ╰─▶ 1 version does not meet the minimumReleaseAge constraint:',
    '        stubx-late@4.0.3 was published at 2026-11-17T15:02:08.019Z, within the',
    '      minimumReleaseAge cutoff (2026-11-16T15:03:08.010Z)',
    '  help: Run the install interactively to approve these picks, add them to',
    '        minimumReleaseAgeExclude in pnpm-workspace.yaml, or wait for the',
    '        packages to mature.'
  ].join('\n'),
  'pnpm-age-transitive': [
    'Error: ERR_PNPM_NO_MATURE_MATCHING_VERSION',
    '',
    '  × installing dependencies',
    '  ╰─▶ 1 version does not meet the minimumReleaseAge constraint:',
    '        stubx-late@4.0.3 was published at 2026-11-17T15:02:09.250Z, within the',
    '      minimumReleaseAge cutoff (2026-11-16T15:03:09.244Z)',
    '  help: Run the install interactively to approve these picks, add them to',
    '        minimumReleaseAgeExclude in pnpm-workspace.yaml, or wait for the',
    '        packages to mature.'
  ].join('\n'),
  'pnpm-auth': [
    'Error: ERR_PNPM_FETCH_401',
    '',
    '  × installing dependencies',
    '  ├─▶ Failed to resolve dependency tree: GET http://registry.test/stubx-dep:',
    '  │   Unauthorized - 401',
    '  │   ',
    '  │   Failed to resolve stubx-dep@^1.0.0',
    '  ╰─▶ GET http://registry.test/stubx-dep: Unauthorized - 401',
    '  help: No authorization header was set for the request.'
  ].join('\n'),
  'pnpm-missing-package': [
    'Error: ERR_PNPM_FETCH_404',
    '',
    '  × installing dependencies',
    '  ├─▶ Failed to resolve dependency tree: GET http://registry.test/stubx-',
    '  │   nope: Not Found - 404',
    '  │   ',
    '  │   Failed to resolve stubx-nope@^1.0.0',
    '  ╰─▶ GET http://registry.test/stubx-nope: Not Found - 404',
    '  help: stubx-nope is not in the npm registry, or you have no permission to',
    '        fetch it.',
    '        ',
    '        No authorization header was set for the request.'
  ].join('\n'),
  'pnpm-tarball-404': [
    'Progress: resolved 1, reused 0, downloaded 0, added 0',
    'Error: ERR_PNPM_TARBALL_HTTP_STATUS',
    '',
    '  × installing dependencies',
    '  ╰─▶ Tarball server returned HTTP 404 for http://registry.test/stubx-dep/-/',
    '      stubx-dep-1.0.1.tgz'
  ].join('\n'),
  'pnpm-tarball-503': [
    'Progress: resolved 1, reused 0, downloaded 0, added 0',
    'Will retry in 10s. 1 retries left.',
    'Will retry in 1m. 0 retries left.',
    'Will retry in 10s. 1 retries left.',
    'Will retry in 1m. 0 retries left.',
    'Error: ERR_PNPM_TARBALL_HTTP_STATUS',
    '',
    '  × installing dependencies',
    '  ╰─▶ Tarball server returned HTTP 503 for http://registry.test/stubx-dep/-/',
    '      stubx-dep-1.0.1.tgz'
  ].join('\n'),
  'pnpm-tarball-reset': [
    'Progress: resolved 1, reused 0, downloaded 0, added 0',
    'Will retry in 10s. 1 retries left.',
    'Will retry in 1m. 0 retries left.',
    'Will retry in 10s. 1 retries left.',
    'Will retry in 1m. 0 retries left.',
    'Error: ERR_PNPM_TARBALL_FETCH_TARBALL',
    '',
    '  × installing dependencies',
    '  ├─▶ Failed to fetch http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz:',
    '  │   error sending request: client error (SendRequest): connection closed',
    '  │   before message completed',
    '  ├─▶ error sending request',
    '  ├─▶ client error (SendRequest)',
    '  ╰─▶ connection closed before message completed'
  ].join('\n'),
  'pnpm-version-direct': [
    'Error: ERR_PNPM_NO_MATCHING_VERSION',
    '',
    '  × installing dependencies',
    '  ├─▶ Failed to resolve dependency tree: No matching version found for stubx-',
    '  │   late@^9.0.0 while fetching it from http://registry.test/',
    '  │   ',
    '  │   Failed to resolve stubx-late@^9.0.0',
    '  ╰─▶ No matching version found for stubx-late@^9.0.0 while fetching it from',
    '      http://registry.test/',
    '  help: The latest release of stubx-late is "4.0.2". Published at 12/31/2019',
    '        ',
    '        If you need the full list of all 1 published versions run "pnpm view',
    '        stubx-late versions".'
  ].join('\n'),
  'pnpm-version-transitive': [
    'Error: ERR_PNPM_NO_MATCHING_VERSION',
    '',
    '  × installing dependencies',
    '  ├─▶ Failed to resolve dependency tree: No matching version found for stubx-',
    '  │   late@^4.0.3 while fetching it from http://registry.test/',
    '  │   ',
    '  │   Failed to resolve stubx-late@^4.0.3',
    '  │   This error happened while installing the dependencies of stubx-',
    '  │   parent@2.0.0',
    '  ╰─▶ No matching version found for stubx-late@^4.0.3 while fetching it from',
    '      http://registry.test/',
    '  help: The latest release of stubx-late is "4.0.2". Published at 12/31/2019',
    '        ',
    '        If you need the full list of all 1 published versions run "pnpm view',
    '        stubx-late versions".'
  ].join('\n'),
  'pnpm10-age-direct': [
    ' ERR_PNPM_NO_MATURE_MATCHING_VERSION  Version 4.0.3 (released 1 minute ago) of stubx-late does not meet the minimumReleaseAge constraint',
    '',
    'This error happened while installing a direct dependency of /project',
    '',
    'The latest release of stubx-late is "4.0.3". Published at 11/17/2026 12:02:06 PM',
    '',
    'If you need the full list of all 2 published versions run "$ pnpm view stubx-late versions".',
    '',
    'If you want to install the matched version ignoring the time it was published, you can add the package name to the minimumReleaseAgeExclude setting. Read more about it: https://pnpm.io/settings#minimumreleaseageexclude'
  ].join('\n'),
  'pnpm10-age-transitive': [
    'Progress: resolved 1, reused 0, downloaded 0, added 0',
    ' ERR_PNPM_NO_MATURE_MATCHING_VERSION  Version 4.0.3 (released 1 minute ago) of stubx-late does not meet the minimumReleaseAge constraint',
    '',
    'This error happened while installing the dependencies of stubx-parent@2.0.0',
    '',
    'The latest release of stubx-late is "4.0.3". Published at 11/17/2026 12:02:06 PM',
    '',
    'If you need the full list of all 2 published versions run "$ pnpm view stubx-late versions".',
    '',
    'If you want to install the matched version ignoring the time it was published, you can add the package name to the minimumReleaseAgeExclude setting. Read more about it: https://pnpm.io/settings#minimumreleaseageexclude'
  ].join('\n'),
  'pnpm10-missing-package': [
    'ERR_PNPM_FETCH_404  GET http://registry.test/stubx-nope: Not Found - 404',
    '',
    '',
    'stubx-nope is not in the npm registry, or you have no permission to fetch it.',
    '',
    'No authorization header was set for the request.'
  ].join('\n'),
  'pnpm10-tarball-404': [
    'Progress: resolved 1, reused 0, downloaded 0, added 0',
    '',
    'Packages: +1',
    '+',
    ' ERR_PNPM_FETCH_404  GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz: Not Found - 404',
    '',
    'No authorization header was set for the request.'
  ].join('\n'),
  'pnpm10-tarball-503': [
    'Progress: resolved 1, reused 0, downloaded 0, added 0',
    '',
    'Packages: +1',
    '+',
    ' WARN  GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz error (ERR_PNPM_FETCH_503). Will retry in 10 seconds. 2 retries left.',
    ' WARN  GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz error (ERR_PNPM_FETCH_503). Will retry in 1 minute. 1 retries left.',
    ' ERR_PNPM_FETCH_503  GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz: Service Unavailable - 503'
  ].join('\n'),
  'pnpm10-tarball-reset': [
    'Progress: resolved 1, reused 0, downloaded 0, added 0',
    '',
    'Packages: +1',
    '+',
    ' WARN  GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz error (ECONNRESET). Will retry in 10 seconds. 2 retries left.',
    ' WARN  GET http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz error (ECONNRESET). Will retry in 1 minute. 1 retries left.',
    ' ECONNRESET  request to http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz failed, reason: socket hang up',
    '',
    'FetchError: request to http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz failed, reason: socket hang up'
  ].join('\n'),
  'pnpm10-version-transitive': [
    'Progress: resolved 1, reused 0, downloaded 0, added 0',
    ' ERR_PNPM_NO_MATCHING_VERSION  No matching version found for stubx-late@^4.0.3 while fetching it from http://registry.test/',
    '',
    'This error happened while installing the dependencies of stubx-parent@2.0.0',
    '',
    'The latest release of stubx-late is "4.0.2". Published at 12/31/2019',
    '',
    'If you need the full list of all 1 published versions run "$ pnpm view stubx-late versions".'
  ].join('\n'),
  'yarn-auth': [
    'yarn install v1.22.22',
    'info No lockfile found.',
    '[1/4] Resolving packages...',
    'error Error: http://registry.test/stubx-dep: Unauthorized',
    'info Visit https://yarnpkg.com/en/docs/cli/install for documentation about this command.'
  ].join('\n'),
  'yarn-missing-package': [
    'yarn install v1.22.22',
    'info No lockfile found.',
    '[1/4] Resolving packages...',
    'error Error: http://registry.test/stubx-nope: Not found',
    'info Visit https://yarnpkg.com/en/docs/cli/install for documentation about this command.'
  ].join('\n'),
  'yarn-tarball-404': [
    'yarn install v1.22.22',
    'info No lockfile found.',
    '[1/4] Resolving packages...',
    '[2/4] Fetching packages...',
    'error Error: http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz: Request failed "404 Not Found"',
    'info Visit https://yarnpkg.com/en/docs/cli/install for documentation about this command.'
  ].join('\n'),
  'yarn-tarball-503': [
    'yarn install v1.22.22',
    'info No lockfile found.',
    '[1/4] Resolving packages...',
    '[2/4] Fetching packages...',
    'error Error: http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz: Request failed "503 Service Unavailable"',
    'info Visit https://yarnpkg.com/en/docs/cli/install for documentation about this command.'
  ].join('\n'),
  'yarn-tarball-reset': [
    'yarn install v1.22.22',
    'info No lockfile found.',
    '[1/4] Resolving packages...',
    '[2/4] Fetching packages...',
    'info There appears to be trouble with your network connection. Retrying...',
    'info There appears to be trouble with your network connection. Retrying...',
    'info There appears to be trouble with your network connection. Retrying...',
    'info There appears to be trouble with your network connection. Retrying...',
    'error Error: http://registry.test/stubx-dep/-/stubx-dep-1.0.1.tgz: socket hang up',
    'info Visit https://yarnpkg.com/en/docs/cli/install for documentation about this command.'
  ].join('\n'),
  'yarn-version-direct': [
    'yarn install v1.22.22',
    'info No lockfile found.',
    '[1/4] Resolving packages...',
    'error Couldn\'t find any versions for "stubx-late" that matches "^9.0.0"',
    'info Visit https://yarnpkg.com/en/docs/cli/install for documentation about this command.'
  ].join('\n'),
  'yarn-version-transitive': [
    'yarn install v1.22.22',
    'info No lockfile found.',
    '[1/4] Resolving packages...',
    'error Couldn\'t find any versions for "stubx-late" that matches "^4.0.3"',
    'info Visit https://yarnpkg.com/en/docs/cli/install for documentation about this command.'
  ].join('\n')
}

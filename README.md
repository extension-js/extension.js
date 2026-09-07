# Analytics branch

Durable record of distribution data that the upstream sources forget.
`traffic.ndjson` gets one line per week from the `Traffic snapshot`
workflow on `main` (`scripts/traffic-snapshot.mjs`): GitHub views, clones,
referrers and popular paths (GitHub keeps 14 days), npm daily downloads for
`extension` (npm has reporting holes), stars and forks.

Docs traffic with referrers lives in PostHog, project "Extension.js Open
Source Metrics", dashboard "Distribution doors". Mintlify's own analytics
counts non-JS agents as humans, so PostHog is the human number.

## UTM convention for every share

Append these to every link you post so the door is attributable:

    ?utm_source=<door>&utm_campaign=<slug>

- `utm_source`: `x`, `linkedin`, `reddit`, `discord`, `newsletter`, `youtube`,
  `blog`, `talk`, `readme`, `npm`.
- `utm_campaign`: short slug of the post or moment, e.g. `4-1-14`,
  `templates-videos`, `mcp-launch`. Reuse the same slug across doors.
- Never invent `utm_medium`, PostHog groups by source and campaign only.

Read it back with the "Distribution doors" dashboard or:

    SELECT properties.utm_source, properties.utm_campaign, uniq(distinct_id)
    FROM events WHERE event = '$pageview' AND properties.$host LIKE '%extension.js.org%'
    GROUP BY 1, 2 ORDER BY 3 DESC

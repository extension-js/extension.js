# Analytics branch

Durable record of distribution data that the upstream sources forget.
`traffic.ndjson` gets one line per week from the `Traffic snapshot`
workflow on `main` (`scripts/traffic-snapshot.mjs`): GitHub views, clones,
referrers and popular paths (GitHub keeps 14 days), npm daily downloads for
`extension` (npm has reporting holes), stars and forks.

## Reading npm downloads

npm's stats API reports 0 for whole days on every package and never fills
them in later. So a 0 is a missing day, never a real count. Each line keeps
the raw `npm` array and adds `npm_week_corrected` and `npm_28d_corrected`,
the mean of the non-zero days scaled to 7 and 28 days, with the window
ending yesterday. `npm_zero_days` lists the dropped days and `npm_outage`
the ones where `react` also read 0, which shows the gap is npm's. Read the
corrected figures, never the raw weekly sum.

Docs traffic with referrers lives in PostHog, project "Extension.js Open
Source Metrics", dashboard "Distribution doors". Mintlify's own analytics
counts non-JS agents as humans, so PostHog is the human number.

## Reading channels

Links go out plain, without UTM tags. Read which channel sent a visitor from
the referrer: PostHog `$referring_domain` on docs pageviews and the GitHub
traffic referrers in each line here. A post that carries no link cannot be
attributed, count it as unmeasured.

    SELECT properties.$referring_domain, uniq(distinct_id)
    FROM events WHERE event = '$pageview' AND properties.$host LIKE '%extension.js.org%'
    GROUP BY 1 ORDER BY 2 DESC

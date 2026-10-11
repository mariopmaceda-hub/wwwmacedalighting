# Marketing attribution release notes

## Scope
This change records privacy-limited, first-touch attribution on the existing homepage quote submission. It uses the production database's pre-existing `quotes.marketing_attribution` column and normalization trigger; no schema changes or new QR codes.

## Existing QR codes
No codes, printed destinations, routes, redirects, or campaign names were created or modified. Existing QR visits are attributable only if their *existing URL* already includes supported UTM parameters. Do not infer QR origin from a bare website URL.

## Personal data protection
Only UTM source/medium/campaign/content, allowed landing paths, referrer origin (not URL paths or query), and a timestamp are collected. No IP address, name, phone, email or customer photos are placed in analytics. Session storage expires with the browsing session. The database's existing sanitizer independently validates values.

## Rollback
Revert the two frontend file changes and deploy the previous Netlify release. No database rollback required. No customer data deletions.

## Testing and launch gates
- Confirm source script loads on homepage and quote submissions include marketing_attribution.
- Confirm a known campaign visit stores sanitized UTM on a test quote in a non-production environment.
- Confirm a normal URL still submits quotes.
- Confirm uploads, previews, deposit processing, Cal scheduling and SMS are unchanged.
- Check the actual Netlify deploy source/commit and configure preview then production promotion.
- Check owner-notification queue dispatcher, credentials and schedule before enabling messages.
- Configure GA4 only with an authorized measurement ID and applicable consent handling. The implementation does **not** claim to install Google Analytics.
- Validate report permissions before exposing any dashboards.

## Audit observations
At audit time, Supabase had a marketing attribution normalization trigger, an owner-quote trigger, and two pending notification records. A matching cron dispatch job was not found. This PR does not turn on dispatch or send emails/SMS.

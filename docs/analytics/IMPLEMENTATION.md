# Public analytics and attribution

## Scope
GA4 G-RXSFMWCDJ9 and Clarity yusyap213r load on allowed public pages only after analytics consent (Global Privacy Control prevents loading). Admin, payment and review pages are excluded. Public consent can be changed through Analytics preferences. Privacy disclosure includes 90-day first-touch campaign storage, vendor use, masking and conversion deduplication.

Homepage and visualizer send quote_cta_click, quote_form_start, and generate_lead after confirmed success. Custom vendor parameters are fixed labels; quote IDs remain local for deduplication. Failed validation/uploads/inserts/finalization do not count. Clarity is skipped when query/referrer/hash content is not recognized as safe.

Nullable quotes.marketing_attribution preserves whitelisted first-touch campaign labels, landing path, referrer origin and timestamp. A sanitizer prevents arbitrary extra fields. The visualizer uses its existing transactional finalizer. Existing customer acknowledgment, preview, deposit, scheduling, retention and spreadsheet trigger definitions/functions remain unchanged.

## Reporting
/inbox/analytics/ uses existing admin authentication and service-only aggregate reporting. Tests and visualizer drafts are excluded; historical Trash/Archive quotes remain included. Period is quote creation date (for a visualizer, its initial draft creation date); completed counts reflect current finalized status. Unverified real/test classification is explicitly disclosed. No data is invented for unavailable GA4 metrics. The GA4 funnel definitions are supplied in the page, but an account-side GA4/Looker view still needs authorized access.

## QR destinations
- Door hanger: https://wwwmacedalighting.netlify.app/?utm_source=door_hanger&utm_medium=qr&utm_campaign=holiday_2026#quote
- Yard sign: https://wwwmacedalighting.netlify.app/?utm_source=yard_sign&utm_medium=qr&utm_campaign=holiday_2026#quote
- Flyer: https://wwwmacedalighting.netlify.app/?utm_source=flyer&utm_medium=qr&utm_campaign=holiday_2026#quote
These represent tracked-link visits, not proven physical scans.

## Notification hold
Both pending owner test jobs must remain pending. No dispatch(false), automatic cron or SMS-only send is authorized. See EMAIL-SETUP.md for Kevin's required domain/Resend/secrets/status-check/approval sequence. Existing worker is deployed, but no messages have been sent. Configuration is enabled following Kevin's approved status-only check; dispatch itself is not scheduled.

## Validation before website deployment
- Analytics browser tests: consent, vendor script requests, validation/upload/insert failures, successful conversion once, source persistence, three sources, masking and custom-event PII exclusion; mocked external services.
- Visualizer browser regression: 56 checks, no errors/external requests.
- Concept Editor: 32 checks, zero pixel differences in parity comparison; no errors/external requests.
- Archive integration tests: boundaries, permissions, shared Trash, preservation, restore, idempotence passed.
- Isolated database and mocked owner-provider tests passed.
- Production rollback-only quote tests verified attribution, notification queueing and existing acknowledgment/preview/spreadsheet hooks; rolled back before external dispatch.
- Production trigger definitions and hashes matched baseline.
- No live payment, deposit, booking, customer SMS, owner SMS or email was sent as a test.

## External account requirements
Browser-account automation is unavailable. GA4 Realtime/DebugView and generate_lead key-event configuration, Search Console ownership confirmation, Clarity dashboard recognition and GA4/Looker report creation are UNVERIFIED. After account access: select the correct GA4 stream, inspect Enhanced Measurement and disable automatic form-interaction measurement to keep this explicit funnel authoritative; confirm no sensitive URL/form data is collected; mark generate_lead as a key event; build a user-sequenced funnel. In Search Console select the existing URL-prefix property and click Verify once the meta tag is live. Clarity uses existing Balanced masking plus explicit masks; account settings were not changed.

## Database security advisor
New private outbox/config tables have RLS and no client policies intentionally: clients have no grants and only the service role accesses them. Existing project warnings (pg_net in public and leaked-password protection disabled) were observed but are outside this release. References: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Provider documentation
https://developers.google.com/analytics/devguides/collection/ga4/views
https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking
https://resend.com/docs/send-with-supabase-edge-functions

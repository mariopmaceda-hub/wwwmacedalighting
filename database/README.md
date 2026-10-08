# Shared Trash and Archive rollout

Policy: removal completion starts 720 hours before Trash; Trash starts 360 hours before Archive. The hourly scheduler never deletes records or files. Archived records are restored through the same admin endpoint. Restore pauses the completion timer until a later job-status change restarts the removal workflow. Customer grouping uses the existing normalized phone/email rules; Customers trashes all active listed order IDs, Jobs trashes one order. Payments and financial totals include archived records.

## Verification
From tests: pnpm install --frozen-lockfile, then pnpm test. Install Playwright Chromium first, or set BROWSER_CHANNEL=msedge for an installed Edge browser. Tests use isolated PGlite and fake browser API responses; never run fixture SQL against production.

## Release sequence
1. Preserve deployed API and database view/function definitions plus current Git main SHA.
2. Apply order-retention.sql transactionally, with scheduler disabled by default.
3. Deploy admin-ops-api and the UI from the same reviewed revision.
4. Verify authenticated-only access, archive list, payment availability and UI navigation.
5. Apply enable-order-retention.sql; inspect cron run result and unchanged source-record counts.

## Recovery
Disable private.retention_config.enabled and deactivate maceda_order_retention first. Keep additive tables and audit history. Fix forward or restore previous API code; revert the frontend Git commit and let Netlify deploy normally. Before reinstating the old view/function definitions, account for archived records so they remain visible and restorable. No source rows/files are removed by this release.

No spreadsheet/calendar writes, payment transactions, customer messages, or one-time test deletions are part of this rollout.

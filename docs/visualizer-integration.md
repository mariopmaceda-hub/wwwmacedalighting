# Visualizer integration — October 8, 2026

## Contract and cost
`maceda-concept/1` consumes Kevin's existing `install_zones` and `selections.placements`. Coordinates are normalized to the processed front photograph. The adapter never clamps, repairs, regenerates or truncates outlines. Confidence below 0.65, hidden zones, invalid bounds, unsupported shapes and incomplete placements block rendering. Missing visibility/occlusion metadata is reported. Explicit normalized polygon `occlusion_masks` exclude original pixels from drawing; no hidden geometry is inferred.

Snapshots detach and freeze the photo path and SHA-256, complete outlines, placements, selections, revision, photo views, additional photos and decoration definitions. The finished preview uses a deterministic PNG compositor. Original pixels outside its lighting/decor layers remain exact; physical sizing is always an unmeasured concept. Existing photo analysis still calls OpenAI and may cost money. Rendering makes no AI requests. Legacy paid-render endpoint returns HTTP 410.

Rendering completes inside the authenticated API request; no queued background work depends on browser continuation. A completed artifact is reused after a lost response. If execution is terminated before completion, the customer retries safely. Source images must be normalized JPG/PNG, max 2400 pixels per side and 8 MB; existing raw WebP sessions must re-upload through the existing browser normalizer. The PNG must fit the existing 10 MB private preview bucket.

## Handoff and integrations
Server copies the preview to a stable quote/render path before the service-only transactional function finalizes the quote. The transaction locks the session and quote, checks revision/current render, inserts one preview version, updates the quote and marks the session submitted. Retry returns the same quote without firing another consent update. Copy/database errors keep the draft recoverable and never claim successful attachment. The function is denied to anon/authenticated roles.

Existing unique quote-per-session index is preserved. Draft creation still invokes the existing Sheets INSERT webhook with `sms_opt_in=false` and draft notes. Its downstream spreadsheet processing is UNVERIFIED; no webhook, Sheets or scheduling trigger is changed. Submission retains the existing consent-triggered acknowledgment, with local tests using a notification counter instead of messages.

## Validation
- 55 isolated browser checks: both journeys, mode switching, saved-state recovery, failed quote submission, SMS wording and Kevin's generator unchanged; 360/390/768/1440 layouts, no external requests/browser errors.
- 16 contract/pixel tests: exact geometry, invalid/hidden/low-confidence rejection, detached snapshots, landscape/portrait/angled coordinate fixtures, original pixels outside overlays, explicit obstruction masks.
- Deno renderer integration with actual PNG codec and isolated storage/database substitutes: upload failure, retry reuse, stale revision rejection.
- Local Postgres-compatible transactional tests: missing artifact/stale revision rejection, one preview/lead/notification on repeated calls, public access denied.
- Typechecked API and renderer in Deno; dependencies pinned with deno.lock.

These tests do not claim real-customer end-to-end operation or verified physical fit. No production AI, payment, SMS/email or customer lead is created by tests. Visual realism on real customer photographs still requires human review.

## Recovery and release
Baseline main: ea9b57cae71de034486cb9643479e482361b8925 (PR #2 merge). Sanitized prior API v12/renderer v7 captures are stored outside the checkout under ../backups. Never restore the old hard-coded credential or paid renderer. Fix forward through a reviewed commit; the additive handoff function is inert until called. Prior frontend assets remain in Git. No records or existing schema columns are deleted.

The new handoff function was separately approved by Kevin on October 8, 2026. Deployment and live verification must be recorded after they actually occur.

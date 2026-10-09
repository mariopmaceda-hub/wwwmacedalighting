# Concept Editor first release — October 9, 2026

The owner authorized publishing the best available first release now and deferring the previously requested photo-set and human-review gates. This is a deliberately limited v1-compatible release, not completion of the full Concept Editor specification. The prior P0 stop condition is superseded for this scope.

## Changes

- Both journeys gain original-photo comparison, zoom and undo/redo for current-session design edits.
- DIY customers can toggle detected runs directly on the photo, or with labeled keyboard controls. Style, Colors, Lights and Decor tabs organize existing controls.
- The interactive view uses a Web Worker importing the existing server compositor directly from `supabase/functions/_shared/compositor.mjs`. There is one source file; no copied renderer or changed v1 geometry/pattern algorithm. The worker works on the original decoded photo dimensions and preserves untouched pixels. Browser/server JPEG decoders may differ slightly; the parity test supplies identical decoded input.
- Existing v1 contract validation runs before preview requests; presets filter unsupported geometry/confidence in both modes. Low-confidence areas are marked as needing review and cannot be added. Previously selected invalid areas can be removed.
- Maceda's 12-inch center-to-center C9 pitch is stated as the installation reference. Image-space spacing and decoration sizing remain illustrative and unmeasured. No footage, quantities, prices or measurements are inferred.
- Fixture behavior is restricted to localhost, loopback and Netlify deploy-preview hosts. Unknown/custom production hosts no longer simulate successful quotes.

## Preservation and limits

No backend function, SQL, catalog data, generator, v1 contract, original shared compositor, homepage, QR, analytics, payments, deposits, scheduling, SMS or quote submission code is changed. Current deployed API v14 includes attribution absent from the main-branch API; do not redeploy that older API. PR #4 remains a separate analytics change.

Geometry correction/add-edge operations, topology/pattern redesign, night presentation, private estimates, preset redesign and staff editing remain deferred. The Minimal Modern gap has not been reproduced or declared fixed. The supplied five installed-lighting photos are local rendering references, not a substitute for detector ground truth or a twelve-photo golden set. These photos are not committed or uploaded to public hosting.

Undo history is in memory for the current photo/mode. Saved selections continue to use the existing save queue and local draft recovery. It is not a new server operation log. Render errors remain recoverable. If browser workers or cross-origin photo decoding are unavailable, the existing quick SVG layout remains available and the customer is directed to create the authoritative final preview.

## Verification

- `node --test tests/concept-contract.test.mjs tests/compositor.test.mjs`: 16 passed.
- `node tests/visualizer-flow.spec.cjs`: 55 isolated journey/regression checks passed. The harness now serves `.mjs` correctly and selects the Lights tab before using its controls.
- `node tests/concept-editor.spec.cjs`: 32 new checks, covering actual pointer toggling, keyboard toggling, undo/redo, colors/decorations, compare/zoom, strict contract checks, original-photo preservation, worker/compositor parity, saved-state recovery and mode isolation. Run with bundled `PLAYWRIGHT_MODULE`, optional local `QA_PHOTO`, and `QA_OUTPUT` outside the repository.
- Verified widths: 360, 390, 768 and 1440. Zero external requests and browser errors in fixture runs. These are desktop Chrome viewport tests, not physical iOS/Android device certification.
- Deno integration, SQL and live quote submission are not rerun for this frontend-only release. No production test leads or communications are created.

Raw outputs/screenshots are retained outside the checkout under `../concept-editor-evidence/`. Deployment is recorded only after confirmation.

## Recovery

Baseline: `fe4159a12432e8bb792e12c83fad35d8b1b30940`; local recovery tag `pre-concept-editor-20261009`; complete history bundle `../concept-editor-evidence/pre-release-20261009.bundle`.

Rollback this frontend release by reverting its merge commit with `git revert -m 1 <release-merge-sha>` on a fresh branch from the current main, reviewing the resulting diff and publishing through the same authorized deployment path. Do not reset main or remove concurrent analytics work. Confirm the deployed assets afterward. No database rollback is needed because no backend/data changes ship. Netlify's retained-deployment restoration remains unverified; do not claim otherwise.

Monitor the first release for worker/CORS failures, save errors and failed preview generation. No automated 72-hour monitoring is configured by this change.

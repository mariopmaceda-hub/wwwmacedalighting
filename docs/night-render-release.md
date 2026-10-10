# Realistic night preview release

Both visualizer modes request a real night image edit instead of returning the editor's daytime dots. The editor remains an instant layout guide. A completed result must pass a separate review for darkness, realism, preserved architecture and the selected lighting. The source photograph and saved design remain attached to the immutable result; physical measurements are never inferred. Maceda's C9 reference is 12-inch center-to-center spacing. Customer previews remain free.

## Verification

- 23 unit, contract and compositor tests passed.
- 127 isolated browser assertions passed: customer journey 56, editor 32, night preview 39. Widths 360, 390, 768 and 1440; no external requests or browser errors in these fixtures.
- 63 isolated PostgreSQL checks passed, including both renderer contracts, rejected failed reviews, missing image, stale design, consent, idempotence, attribution preservation, restricted access and rollback.
- Two owner-authorized real screenshot tests used the restricted preview service. The first was correctly rejected for extra illumination. The second passed every automated review field and was visually inspected: dark sky, warm-white roofline bulbs, localized glow and reflections. The source was the supplied screenshot, which already contained schematic overlays, rather than a clean original photograph.
- Production API v15 reused the second image by its snapshot without another paid generation; invalid session authorization was rejected.
- Netlify PR preview build succeeded. Its URL requires authentication (HTTP 401); hosted preview browser verification was unavailable. Real image testing used the restricted backend preview and local frontend tests.
- No test contacts, leads, quote submissions, payments, scheduling changes or messages were created. No QR codes or destinations changed. The merged analytics release is preserved.

These results do not establish measured bulb scale or accuracy on every house, decoration, photo angle or physical phone. Full original Concept Editor photo-set and device review remains deferred under the owner's limited-release instruction. AI output is labeled as a concept; failures do not fall back to schematic dots as a finished result.

## Coordinated release

Production baseline: `f8485ed9a6a2ec58ed88e07370a7b4fb16495401`, tagged `pre-night-render-20261009`. A local Git bundle and deployed API v14 source backup were saved outside the public repository.

The additive finalizer change was applied through Supabase as migration `20261010053304_visualizer_reviewed_night_handoff`; this repository records the exact generated migration version. Verified function MD5 `7a46a822545cf41f1657b663fab037a1`; anon/authenticated execute remain denied and service_role execute remains allowed. Attribution and existing records are preserved.

The API is deployed before the frontend. New pages explicitly request `render_style: night`. Already-open older pages retain their supported renderer during rollout. New night requests never silently fall back to the old outline renderer. Current API source excludes preview-only access and debugging URLs.

Frontend publication and final public URL verification are recorded in the release PR. The unrelated pre-existing Supabase GitHub migration-history mismatch must not be repaired by replaying old migrations or resetting the database.

## Rollback

Revert the night-render PR merge from fresh main, or republish the baseline tag if no subsequent work would be lost. Preserve the analytics release and concurrent changes. Restore customer-visualizer-api using the saved v14 files if backend rollback is needed; keep its custom session authorization and deployed attribution.

Prefer retaining the backward-compatible finalizer acceptance so saved night previews remain usable. If explicitly necessary, `docs/proposals/visualizer-night-handoff-rollback.sql` reverses only the new guard and refuses unexpected function drift; it does not delete records. No database/storage restore or customer-data deletion is part of rollback. The two test images and isolated session may remain private for diagnosis; the dedicated preview endpoint is retired after verification.

# Visualizer branch review

This branch does not change backend functions, schema, upload processing, contact/lead saving, quote submission, SMS consent, homepage content, or geometry/outline generation.

Run `node tests/visualizer-flow.spec.cjs` with the existing Playwright dependency. Optional environment variables: `PLAYWRIGHT_MODULE`, `BROWSER_PATH`, and `QA_OUTPUT`. The test intercepts external requests and uses isolated fixtures. It never contacts production services. Generated screenshots belong outside the repository.

Every hostname except the existing `wwwmacedalighting.netlify.app` production hostname uses `preview-fixture.js` in-memory/sessionStorage data. The review banner, image caption, and simulated quote confirmation explicitly identify this. Use **Load example home** to explore the flow. No actual AI analysis, realistic rendering, production uploads, or quote submission occurs in a preview. Confirm any future custom production hostname before releasing this branch.

## Integration boundary for Kevin

`window.MacedaConceptProvider({zones, catalog})` is an optional synchronous hook returning candidates shaped as `{preset, zones: [zoneId], decor: [catalogCustomerName]}`. Preset names must be supported by the existing API. Omit the hook to use the existing preset map. `directions.js` filters candidates to detected zones with usable geometry and confidence >= 0.65, validates decoration eligibility, deduplicates identical scopes, and returns at most three. Missing/uncertain features produce fewer choices instead of invented architecture.

Concept card previews reuse the existing `draw()` implementation without modifying its geometry. New direction names or metadata cannot be persisted by the current API and are intentionally not introduced. The rendering prompt and backend outline generation remain untouched.

## State and verification

Mode switches retain the session, contact form values, uploaded paths and analysis. Design selections and render state reset. Saves share a serialized queue; obsolete mode generations are skipped, and local drafts record interrupted switches. A render is requested only after a save/readback matches the selected preset, color, zones, decorations and placement targets. Browser history cannot resurrect another mode's design.

Before production approval, a separate controlled end-to-end live-service test is still needed for actual AI image quality and backend integration. The fixture tests establish UI behavior and request contracts, not production AI correctness. This PR is for branch/preview review only; do not merge or deploy production without the user's instruction.

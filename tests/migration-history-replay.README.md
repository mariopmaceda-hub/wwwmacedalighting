# Isolated historical-migration replay

This is a **synthetic, network-blocked compatibility test**, not a production
migration or a proof that the repository bootstraps an empty Supabase project.
Never point it at a database server: the harness accepts no connection string
and creates only an in-memory PGlite instance.

## Inputs and limits

- `migration-history-manifest.json` pins all 29 reviewed candidate
  files byte-for-byte. The original literal Vault provisioning prefix is absent;
  the retained SQL tail has a separately asserted canonical SHA256.
- `migration-prehistory-fixture.json` contains a synthetic dependency subset of
  72 column declarations across six prerequisite relations, informed by current
  types/nullability, **not exact historical DDL**. Unreferenced columns and every
  column added by the recorded migrations are excluded. Later tables,
  views, and functions are created by the migrations themselves.
- Primary keys, defaults, pre-existing INSERT policies, service-role grants and
  BYPASSRLS, and `private.is_admin` are explicitly synthetic. Unrecorded historical
  foreign keys, CHECK constraints, defaults, policies, and extension behavior are
  not established by this test.
- Vault, entropy, net, and cron are inert SQL stubs. Callbacks are recorded as
  intentions; scheduled SQL is stored, never executed. No real extension worker,
  secret, customer record, payment, lead submission, or external provider is used.
- Only two exact unsupported extension declarations (`pg_net`, `pg_cron`) are
  replaced in memory by comments. All remaining migration SQL executes unchanged.

## Run

Use a locally installed, independently integrity-verified **PGlite 0.3.14** and
Node 24 permission mode. Installing dependencies is deliberately not part of the
harness. From repository root, with absolute allowlisted paths:

```sh
PGLITE_MODULE=/absolute/path/to/verified/pglite/package \
node --permission \
  --allow-fs-read=/absolute/path/to/repository \
  --allow-fs-read=/absolute/path/to/verified/pglite/package \
  --require ./tests/offline-network-guard.cjs \
  tests/migration-history-replay.cjs
```

For a separately staged candidate, set `MIGRATION_REPLAY_DIR` to its absolute
`supabase/migrations` directory and allow read access to that directory. The
manifest must still match exactly. The harness has **no filesystem-write,
subprocess, native-addon, WASI, or worker permission**.

Node 24 permission mode does not itself block sockets. The mandatory preload and
complementary harness guards block HTTP(S), HTTP2, TCP, TLS, UDP, DNS, fetch,
WebSocket, workers, and child processes before loading PGlite. ESM builtin exports
are synchronized. A constants-only `process.binding` shim supplies public frozen
filesystem flag values needed by this PGlite version; no native binding is
returned. Intentional socket/fetch/DNS Resolver guard self-tests must throw before SQL runs.

These guards provide defense in depth for the reviewed, pinned dependency, not
an adversarial-code sandbox. The database itself has no outbound extensions.

## Assertions

The replay verifies all 29 ordered migrations, candidate hashes unchanged,
absence of the secret-provisioning prefix, no outbound calls during migration,
inert cron/deposit behavior, and missing-preview-token warning/skip. It checks
the exact pre-night finalizer checksum and guard-only replacement with unchanged
ACL/owner/configuration; actual anon/authenticated denial; deterministic and
reviewed-night handoff under a synthetic non-superuser service role; preview and
owner-outbox idempotence; stale design/bad night review/missing image rejection;
and attribution sanitization, original-value preservation, and Pasadena support.

A passing run is useful evidence for historical source reconciliation. It does
**not** authorize replay in production, repair migration records, deploy edge
functions, prove real Vault/cron/net behavior, or prove an exact fresh install.
New environments still require their genuine bootstrap schema and separately
approved provisioning of the omitted preview token before operational use.

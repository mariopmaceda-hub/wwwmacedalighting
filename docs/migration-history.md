# Historical migration reconciliation

The migration directory restores the 29 versions already recorded by the existing
deployment. Two filenames were corrected to their applied timestamps without
changing SQL. This is a repository-history repair, **not a database upgrade**.
Do not replay these historical statements on production, mark versions reverted,
or use a reset/history-repair command to make deployment checks pass.

## Intentional source exceptions

- The preview-automation migration omits an old literal credential-provisioning
  block. Its trigger, function, and storage statements are retained. No credential
  value or replacement credential is included. A new environment without
  `maceda_preview_webhook_token` warns and skips the automatic preview callback;
  operational provisioning requires an independently reviewed setup.
- The reviewed-night migration is unchanged from Git. Recorded history contains
  one additional trailing CRLF pair; the SQL is otherwise identical.

The directory is not a complete blank-database bootstrap. It assumes earlier
quote, product, and visualizer schema foundations. Do not launch a fresh cloud
preview from this history without a separately reviewed baseline and safe
operational configuration. Historical SQL includes production callback URLs,
triggers, cron scheduling, and existing-row updates. Missing production data in
a preview does not make those side effects safe.

## Deployment boundary

This repair adds no `config.toml`, Edge Function declarations, Auth settings,
secrets, or deployment workflow. With a functions directory but no function
declarations, the Supabase GitHub integration deploys no functions and warns.
Keep function packaging/authentication changes separate from history repair.
See the [Supabase integration documentation](https://supabase.com/docs/guides/deployment/branching/github-integration#edge-functions).

Before publication, compare the exact current production version set with the
repository and require **zero pending or missing versions**. Do not create a
paid or callback-capable preview without approval. An already-applied production
history must remain untouched.

## Isolated regression test

`tests/migration-history-replay.cjs` applies the ordered history to in-memory
PGlite 0.3.14 using an explicitly synthetic prerequisite-schema fixture. It
checks finalizer permissions, reviewed-night and deterministic handoffs,
attribution, idempotent outbox creation, and missing-token behavior. It uses
inert SQL substitutes for Vault, entropy, HTTP and cron; exact unsupported
extension-creation statements are adapted only in the test process.

Run with Node 24, the locked test dependencies, the required offline
network preloader, Node permission mode, and read access only to the repository
and dependency directory. The harness refuses filesystem writes, child processes,
workers and native addons. `PGLITE_MODULE` may identify an independently verified
local package directory when dependencies are installed outside the repository.

```sh
# From the repository root after installing tests' locked dependencies.
node --permission --allow-fs-read="$PWD" \
  --require ./tests/offline-network-guard.cjs tests/migration-history-replay.cjs
```

The synthetic fixture does not establish exact historical defaults, constraints,
RLS configuration, or fresh-install equivalence. Tests do not contact production,
send customer messages, invoke providers, or authorize deployment. Do not replace
the inert substitutes with real extensions or credentials.

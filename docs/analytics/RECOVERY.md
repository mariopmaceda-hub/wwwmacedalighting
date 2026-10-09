# Analytics recovery baseline

Recorded before production changes: main fe4159a12432e8bb792e12c83fad35d8b1b30940; Netlify production deploy 6ac82ee4fb791b00083eea4f. Visualizer API v13, retired renderer v8, customer acknowledgment v2, lead-followup-worker v3, send-sms v6, admin-ops-api v8.

Current pre-analytics website recovery baseline, rechecked October 9: commit 0fd85931c10a2fcd2acf811adcdb8943e8fcfb61, Netlify deploy 6ac8fea1e044850008d31f5e. This includes the newer Concept Editor release.

Rollback the website by restoring this newer Netlify deploy (or reverting only this analytics PR after checking concurrent changes). Restore customer-visualizer-api from that commit if necessary; its prior finalizer remains compatible with the nullable attribution column. Restore the SQL finalizer from docs/proposals/visualizer-atomic-handoff.sql if needed. Do not drop quote records or attribution columns to roll back. Pause new owner alerts with UPDATE private.owner_notification_config SET enabled=false WHERE singleton=true; unschedule only maceda_owner_notifications. Preserve the outbox audit. Existing customer, payment, scheduling, preview, Trash and Archive functions are unchanged.

No secrets are included in this recovery record. Existing worktrees are preserved.

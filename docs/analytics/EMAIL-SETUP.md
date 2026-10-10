# Owner notifications: sending paused by Kevin

Do not dispatch the queue or schedule automatic dispatch. Preserve both pending test jobs; do not send SMS alone without explicit approval. SMS configuration is ready. Email is not configured. No company-owned sending domain has been confirmed.

1. Obtain/confirm the Maceda Lighting custom domain.
2. Set up Resend using that domain.
3. Verify the sending domain.
4. Use a sender such as notifications@macedalighting.com (example only; not a confirmed domain).
5. Store RESEND_API_KEY securely in Supabase Edge Function secrets.
6. Store OWNER_NOTIFICATION_EMAIL_FROM securely.
7. Run dispatch_owner_notifications(true) again to verify email readiness.
8. Stop for approval before dispatch_owner_notifications(false).

Never put credentials in frontend code, GitHub, SQL output, chat, logs or Notion. A configuration-presence check is not a delivery test.

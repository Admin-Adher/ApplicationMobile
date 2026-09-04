# Transactional email delivery — 2026-09-04

## Confirmed incident evidence

- Supabase Auth logged recovery mail submission at 21:03 and 21:04 UTC for the reported user, with sender `noreply@mail.app.supabase.io` and HTTP 200 on `/recover`. This is not a receipt from the destination mailbox.
- Supabase custom SMTP is not configured. The site URL points to the landing page; the allowed recovery redirect is `/reset-password`.
- BuildTrack Gmail contains the reported user's invitation, but the targeted search found no recovery message or bounce for that user. A separate August 21 notification has a generic Gmail rejection. Do not attribute that unrelated rejection to the reported user.
- A hosted, read-only SMTP authentication check succeeded in 239 ms. Credentials and sender match are configured; authentication alone does not prove message acceptance or inbox delivery.
- The read-only 14-day invitation sample contains three accepted invitations. This does not prove that every mail was delivered.

## Corrected application contract

1. Recovery and invitation endpoints persist an encrypted request before returning HTTP 202. The response means **queued**, not delivered. Unknown accounts use the same public path and throttling.
2. Exact invitation token, recipient, status, expiry and organization are validated server-side. Names and roles are loaded from the database, not trusted from the caller's template fields.
3. Only the service role can access the outbox and claim/enqueue RPCs. Recipient/IP fingerprints are keyed hashes. Payloads are AES-256-GCM encrypted and bound to their request ID; terminal states erase the encrypted content. Metadata retention is thirty days.
4. A worker stores the generated recovery token before SMTP submission. Definitive transient rejections can retry up to four attempts using the same token. A timeout/crash after submission is **uncertain** and is never blindly replayed. A 90-second claim prevents overlapping workers.
5. Immediate work runs through Next `after`. The GitHub scheduled worker is a fallback every five minutes, not a latency guarantee: GitHub schedules can be delayed. Monitor delayed and failed requests.
6. The sender fails closed without configuration, has bounded SMTP timeouts, checks accepted/rejected recipients, provides a plain-text alternative, and records the provider message ID without logging message content or recipients.
7. New recovery links carry the hash in the fragment. Loading the page does not consume it. Verification occurs only on password submission, in an isolated, non-persisted session. Legacy implicit-token links remain supported. An unrelated signed-in session is never sufficient.
8. Expired pending invitations can be renewed through the authorized RPC. PDF email failures no longer return unconditional success; partial delivery reports an accepted count to avoid mass duplicate resends.

## Required release order

1. Run application tests, both app/test type-checks, the Next build and the PostgreSQL contract test.
2. Apply `20260904220000_durable_transactional_emails.sql` through the authorized Supabase migration workflow. Verify server-only privileges and PostgREST schema refresh. Do not invoke a real recovery request as a migration test.
3. Confirm `EMAIL_OUTBOX_SECRET` or existing `RESERVE_TOKEN_SECRET` has at least 32 characters. Use a strong random secret. Keep it stable while jobs are outstanding; rotation otherwise makes pending payloads unreadable.
4. Deploy the application and the scheduled fallback. `CRON_SECRET` in GitHub must match Vercel. The worker never accepts unauthenticated requests. Platform admins can inspect redacted recent receipts at `/api/admin/email-delivery` with their authenticated bearer token.
5. Only after the new reset page is live, update the Supabase recovery template link to `https://buildtrack-mobile.vercel.app/reset-password#token_hash={{ .TokenHash }}&type=recovery`. Do not put a one-use `/verify` link back in a prefetchable email.
6. Configure custom SMTP in Supabase as well as BuildTrack; otherwise dashboard/legacy `/recover` calls still use the separate built-in service. Gmail can be a bridge, but a BuildTrack-owned transactional domain/provider is the production target. Do not use a different product's verified domain.
7. Run an explicitly authorized test with a controlled recipient. Confirm server acceptance, received message, expiry/one-use behavior and actual password recovery (credential entry stays manual). For the corporate mailbox, obtain inbox/quarantine or mail-trace evidence before calling the incident resolved.

## Provider setup and operations

Generic SMTP variables: `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS or 465 TLS), `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`. If `SMTP_HOST` is absent, existing `GMAIL_USER` and `GMAIL_APP_PASSWORD` are supported. App passwords are not the Google account password and must never be pasted into tickets or diagnostics.

For a dedicated sending domain, configure the provider's SPF/DKIM records and aligned DMARC; validate the provider domain before switching. Prefer a provider with delivery/bounce webhooks. The current `accepted` state deliberately makes no inbox-delivery claim; there is no invented delivered webhook state.

On failure: look up request ID, classify `failed` versus `uncertain`, check provider receipts/bounces, and only then resend through the user workflow. Do not replay all failed jobs, bypass tenant scope, log payloads or grant authenticated users access to the queue.

Rollback application code before removing a schema dependency. The additive table can remain; do not drop an outbox with outstanding requests. Disable the scheduled worker when rolling back to an application that does not expose its endpoint.

References: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [email prefetching](https://supabase.com/docs/guides/auth/auth-email-templates#email-prefetching), [Nodemailer Gmail guidance](https://nodemailer.com/guides/using-gmail).

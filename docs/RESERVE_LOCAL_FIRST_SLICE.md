# Reserve local-first slice

This file tracks the first vertical slice for durable offline reserve sync.
It is intentionally narrow: reserves only, with operation idempotency, row
versions, soft-delete awareness, and append-only status events.

## Server migration

Apply this migration on a Supabase test branch before production:

```text
supabase/migrations/20260615120000_reserve_local_first_slice.sql
```

It adds:

- `reserves.version`, incremented by trigger.
- A preflight check for `auth_user_role`, `auth_user_org`, and
  `auth_user_has_permission`.
- `reserve_outbox_operations`, keyed by `operation_id` with `request_hash`.
- `reserve_status_events`, append-only, ordered by `occurred_at`.
- `apply_reserve_patch(...)`, returning typed results.
- `append_reserve_status_event(...)`, returning typed results.

Expected RPC statuses:

```text
ok
version_conflict
deleted
forbidden
not_found
duplicate_operation_mismatch
invalid_payload
```

## Client behavior

Reserve rendering remains:

```text
screen = materialize(base, pending)
```

The current app keeps pending reserve rows from local cache when a live refresh
returns older server data. New reserve mutations now carry:

```text
operation_id
request_hash
baseVersion
```

`request_hash` is computed from a canonical JSON payload: sorted object keys,
stable primitive values, no queue metadata.

Status is not a generic reserve patch field. It changes only through
`append_reserve_status_event`; `reserves.status`, `closed_at`, and `closed_by`
are folded from `reserve_status_events`.

Additive collections are not overwritten by the generic reserve patch. Comments
use the existing `commentPatch` merge-by-id queue path, photos use `photoPatch`,
and `history` is merged by entry id on the server.

## Deterministic failure injections

Run these on a Supabase test branch with a disposable reserve.
Use a service-role SQL session or the dashboard SQL editor for post-call
assertions, because several invariants live behind RPCs and revoked direct
table grants.

The important assertion rule: do not stop at the RPC status. Every scenario
must assert final database state and, when the operation is rejected, assert the
absence of writes. These bugs are silent regressions: a result can look correct
while a forbidden column, event log, or additive array was still mutated.

### Lost ack

1. Call `apply_reserve_patch` with `operation_id = X`, `base_version = N`.
2. Drop the client response or replay the same request.
3. Call `apply_reserve_patch` again with the same `operation_id` and same hash.

Expected: second call returns the stored `ok`, not `version_conflict`.
Assert that `reserve_outbox_operations` has one row for `X`, the reserve field
changed once, and `reserves.version` did not increment twice.

### Duplicate operation mismatch

1. Call `apply_reserve_patch` with `operation_id = X` and patch A.
2. Call it again with `operation_id = X` and patch B.

Expected: `duplicate_operation_mismatch`.
Assert that patch B did not change any reserve field and that the stored
operation result for `X` was not replaced with a new successful write.

### Invalid payload

1. Call `apply_reserve_patch` with a forbidden field such as `status`,
   `comments`, `photos`, or `closed_at`.
2. Call it with a malformed integer/timestamp field.

Expected: `invalid_payload`, stored in `reserve_outbox_operations`, not a raw
SQL exception.
Assert that `reserves.status`, `closed_at`, `closed_by`, `comments`, `photos`,
`photo_uri`, `photo_annotations`, and `company_signatures` are unchanged.
Assert that no `reserve_status_events` row was inserted and that malformed
scalar fields did not partially update the reserve.

### Version conflict

1. Read reserve version `N`.
2. Update the reserve from another session so server version becomes `N + 1`.
3. Replay the first edit with `base_version = N`.

Expected: `version_conflict` with `current_version`.
Assert that the stale patch fields are absent from `reserves` after the call.

### Deleted parent

1. Read reserve version `N`.
2. Soft-delete the reserve from another session.
3. Replay an edit against the old version.

Expected: `deleted`, not `version_conflict`.
Assert that the attempted edit did not change any reserve field and did not add
history, status events, comments, or photos for the deleted reserve.

### Late status event

1. Insert event A: `open -> closed`, `occurred_at = 11:00`.
2. Insert event B: `closed -> open`, `occurred_at = 09:00`, after A.

Expected: current reserve status remains `closed`; the late older event is kept
in `reserve_status_events` but does not overwrite the folded current status.
Assert both event rows exist, `reserves.status = 'closed'`, and `closed_at` /
`closed_by` still match the winning close transition.

### Future client clock

1. Insert event A with a normal `occurred_at`.
2. Insert event B with `occurred_at` three days in the future.
3. In a separate statement after a short delay, insert event C with a normal
   `occurred_at`.

Expected: server clamps event B's `occurred_at` to server `now()` before
folding status, so event C can become the real latest transition.
Assert event B's stored `occurred_at <= created_at` and
`occurred_at <= now()` at insertion time. Assert the folded `reserves.status`
matches event C after it is inserted, proving that one bad future clock did not
freeze the reserve status for days.

### Additive merge by ID

1. From session A, queue or replay a `commentPatch` add with comment id `A`.
2. From session B, queue or replay a `commentPatch` add with comment id `B`
   against the same reserve and an overlapping stale comments snapshot.
3. Repeat the same shape for `history` by sending two `apply_reserve_patch`
   calls with different history entry ids.

Expected: both additions survive.
Assert the server arrays contain ids `A` and `B`, contain no duplicate id, and
still contain any pre-existing entries. The final array must not equal a stale
last-writer snapshot.

## Maintenance

`reserve_outbox_operations` is internal: direct table grants are revoked for
`anon` and `authenticated`; access is through RPC replay only. The migration
adds `purge_old_reserve_outbox_operations(interval)` for service-role
maintenance, defaulting to 14 days.

## Metrics to add after branch deployment

- `reserve_stale_write_rate`: write attempted with `baseVersion` older than live.
- `reserve_outbox_pending_count`.
- `reserve_outbox_terminal_count`.
- `reserve_outbox_oldest_pending_age_ms`.
- `reserve_photo_pending_count`, once photos get their own sub-outbox.

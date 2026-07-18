# Waivers — decisions to double-check

The M3 first slice (see [roadmap.md](roadmap.md) M3) made several **reasoned guesses** to keep the
increment shippable. None are hard to reverse. Aaron: skim these and correct any that don't match how
a real dive shop should work — each lists where to change it.

## Guesses I made

| # | Decision | Why I chose it | If wrong, change here |
| --- | --- | --- | --- |
| 1 | **Typed-name signature** (diver types full legal name), no drawn signature or e-sign vendor | Zero new deps; no blob store chosen yet; legally reasonable for a first slice | ADR [20260718-waiver-signatures](../architecture/decisions/20260718-waiver-signatures.md); add a signature-artifact column to `waivers` |
| 2 | **Completion links expire after 14 days** | Long enough for pre-arrival, short enough to limit a leaked link | `WAIVER_LINK_TTL_DAYS` in `src/lib/waivers.ts` |
| 3 | **Booking auto-issues a waiver** and shows the link on the diver confirmation | Removes a staff step; diver can sign immediately after booking | `bookSpot` action in `src/app/trips/[id]/page.tsx` (remove the `issueWaiver` call to make it staff-initiated only) |
| 4 | **Any "yes" → `referral_required`, and an unanswered question also fails closed** | Safety: never let an incomplete/positive medical form read as "ready" | `needsReferral` / `outcomeStatus` in `src/lib/waivers.ts` |
| 5 | **One active waiver per booking**; re-issuing refreshes the token (old link dies), signed waivers are never re-issued | Simple, idempotent, immutable | `issueWaiver` in `src/db/waivers.ts` (unique index `waivers_booking_unique` in `schema.ts`) |
| 6 | **5 RSTC-style medical questions**, hard-coded in the seeded template | Enough to exercise the flow; real RSTC form is longer/branching | `MEDICAL_QUESTIONS` in `src/db/seed.ts` |
| 7 | **Signed waivers kept indefinitely; no deletion path** | Liability records; retention policy belongs with hosting/GDPR work | ADR consequences section; revisit with hosting ADR |
| 8 | **Waiver is per booking, not per person per shop** | A booking is the unit staff act on; matches the roster | would need a person-level waiver table if a signed waiver should carry across trips |

## Deliberately deferred (not built yet)

- **Staff template authoring/versioning UI** — the schema supports versions (`waiver_templates.version`,
  publish/archive status), but there's no screen to create or supersede a template. Templates are
  seeded. This is the biggest gap before a shop could self-serve.
- **Resume / re-send UX for divers** — a diver who abandons the form just reopens the same link; there's
  no "we saved your progress" or email re-send.
- **Medical-answer privacy at rest** — answers sit in Postgres in plain form. Encryption/access control
  is called out for the hosting ADR (roadmap M1 open item).
- **Signed-PDF export** and **audit trail of staff exceptions** — Phase B "nice to have", not required
  for the demoable slice.
- **Shared readiness model** — waiver status is currently waiver-specific. M4 (cert checks) should
  generalize it into the typed readiness result described in next-steps Phase C, and this UI should move
  onto it rather than growing a second ad-hoc status.

## What is solid (tested, don't re-litigate)

- Fail-closed medical evaluation, expiry, idempotent + transactional submission, immutability of signed
  rows, and tenant scoping are covered by `src/lib/waivers.test.ts`, `src/db/waivers.test.ts`, and
  `e2e/waiver.spec.ts`.

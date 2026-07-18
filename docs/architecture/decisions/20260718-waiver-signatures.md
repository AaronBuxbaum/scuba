# 20260718-waiver-signatures — Store waivers as typed-name signatures on immutable versioned records

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

M3 (docs/product/roadmap.md, docs/product/next-steps.md Phase B) needs a pre-arrival waiver flow: a
diver signs a liability release + RSTC-style medical statement from a link, and staff see readiness.
The milestone demands immutable signed history, fail-closed medical referral, idempotent submission,
and explicit tenant scoping — but the shop is single-instance, unhosted (hosting ADR is still open,
roadmap M1), and has no payment or third-party integrations yet. We need a signature representation
that is legally reasonable for a first slice without committing to an external e-signature vendor or
a document/blob store before hosting exists.

## Decision

Capture a **typed-name signature**: the diver types their full legal name, checks an acknowledgement,
and submits. We store the typed string, the per-question medical answers, and a `signed_at` timestamp
on a `waivers` row, which references the exact `waiver_templates` version (body + question wording)
the diver agreed to. Signed rows are **immutable** — once a waiver leaves `pending` for `signed` or
`referral_required`, the domain layer never rewrites its signed fields; corrections issue a new
version. Access to sign is via a per-booking opaque token (`base64url`, 24 random bytes) with a
14-day expiry; the token is the only credential a diver presents. Submission is transactional and
idempotent (re-submit returns the stored outcome), and the terminal status is derived server-side
from the answers, never trusted from the client (`src/lib/waivers.ts`, `src/db/waivers.ts`).

Retention: signed waivers are kept indefinitely for now (liability records); no deletion path ships
in this slice. There is no external service and no binary artifact — nothing leaves Postgres.

## Alternatives considered

- **Third-party e-signature (DocuSign/HelloSign)** — real signatures + audit trail, but adds a paid
  external dependency, PII egress, and webhook infrastructure before hosting or payments exist.
- **Drawn-signature canvas image** — feels more "real" but needs blob storage (no store chosen yet)
  and adds little legal weight over a typed name with a timestamp and IP-less token binding.
- **Mutable waiver row updated in place on correction** — simpler, but destroys the signed-history
  immutability the milestone requires for audit and dispute.
- **PDF generation of the signed release** — deferred; it is a rendering of the stored record and can
  be added later without changing the data model.

## Consequences

Makes easy: a complete, testable flow with zero new runtime dependencies; reproducible signed history
(template version is pinned); a readiness signal (`signed` / `referral_required` / `pending`) that M4
cert checks and M6 manifests can consume without rework. Makes hard / commits us to: typed-name
signatures are weaker evidence than a countersigned or vendor-backed signature; we store PII (medical
answers) in Postgres, so the hosting ADR must cover encryption at rest and access control. Escape
hatch: adopting a vendor or drawn-signature capture means adding a signature-artifact reference column
and an issuer field to `waivers` and writing a backfill — the immutable-version spine does not change.
Revisit when a shop requires legally-countersigned waivers, when retention/GDPR-style deletion is
needed, or when the hosting decision lands.

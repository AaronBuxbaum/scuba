import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  allAnswered,
  type MedicalAnswers,
  outcomeStatus,
  pickAnswers,
  waiverExpiry,
} from "@/lib/waivers";
import type { AppDb } from "./client";
import { bookings, people, trips, waivers, waiverTemplates } from "./schema";

/** URL-safe opaque token for a completion link. */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The latest published waiver template for a shop, or null if none exists. */
export async function getPublishedTemplate(db: AppDb, shopId: string) {
  const [template] = await db
    .select()
    .from(waiverTemplates)
    .where(and(eq(waiverTemplates.shopId, shopId), eq(waiverTemplates.status, "published")))
    .orderBy(desc(waiverTemplates.version))
    .limit(1);
  return template ?? null;
}

export type IssueOutcome =
  | {
      ok: true;
      waiverId: string;
      token: string;
      status: "pending" | "signed" | "referral_required";
    }
  | { ok: false; reason: "no_template" | "no_booking" };

/**
 * Ensure a booking has a waiver, returning its completion token. Idempotent:
 * a signed waiver is returned untouched (immutable); a still-pending one keeps
 * its identity but refreshes its token + expiry so a re-sent link works and
 * old links stop working. Requires a published template for the shop.
 */
export async function issueWaiver(
  db: AppDb,
  input: { shopId: string; bookingId: string },
): Promise<IssueOutcome> {
  return db.transaction(async (tx): Promise<IssueOutcome> => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1);
    if (!booking) return { ok: false, reason: "no_booking" };

    const [existing] = await tx
      .select()
      .from(waivers)
      .where(eq(waivers.bookingId, input.bookingId))
      .limit(1);

    if (existing) {
      if (existing.status !== "pending") {
        return { ok: true, waiverId: existing.id, token: existing.token, status: existing.status };
      }
      const token = newToken();
      await tx
        .update(waivers)
        .set({ token, expiresAt: waiverExpiry() })
        .where(eq(waivers.id, existing.id));
      return { ok: true, waiverId: existing.id, token, status: "pending" };
    }

    const [template] = await tx
      .select({ id: waiverTemplates.id })
      .from(waiverTemplates)
      .where(and(eq(waiverTemplates.shopId, input.shopId), eq(waiverTemplates.status, "published")))
      .orderBy(desc(waiverTemplates.version))
      .limit(1);
    if (!template) return { ok: false, reason: "no_template" };

    const token = newToken();
    const [created] = await tx
      .insert(waivers)
      .values({
        shopId: input.shopId,
        bookingId: input.bookingId,
        templateId: template.id,
        token,
        expiresAt: waiverExpiry(),
      })
      .returning();
    if (!created) throw new Error("issueWaiver: insert returned no row");
    return { ok: true, waiverId: created.id, token, status: "pending" };
  });
}

/**
 * The full context a signing page needs, fetched by token alone (the token is
 * the only key a diver holds). Joins the template, booking, diver, and trip.
 */
export async function getWaiverByToken(db: AppDb, token: string) {
  const [row] = await db
    .select({
      waiver: waivers,
      template: waiverTemplates,
      booking: bookings,
      person: people,
      trip: trips,
    })
    .from(waivers)
    .innerJoin(waiverTemplates, eq(waiverTemplates.id, waivers.templateId))
    .innerJoin(bookings, eq(bookings.id, waivers.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(waivers.token, token))
    .limit(1);
  return row ?? null;
}

export type SubmitOutcome =
  | { ok: true; status: "signed" | "referral_required"; already: boolean }
  | { ok: false; reason: "not_found" | "expired" | "incomplete" };

/**
 * Record a diver's signed waiver. Transactional and idempotent: re-submitting
 * an already-terminal waiver returns its stored result without rewriting it
 * (signed history is immutable). Fails closed on expiry and on any unanswered
 * medical question; the terminal status is derived, not trusted from input.
 */
export async function submitWaiver(
  db: AppDb,
  input: { token: string; signature: string; answers: MedicalAnswers; now?: Date },
): Promise<SubmitOutcome> {
  const now = input.now ?? new Date();
  const signature = input.signature.trim();
  return db.transaction(async (tx): Promise<SubmitOutcome> => {
    const [row] = await tx
      .select({ waiver: waivers, template: waiverTemplates })
      .from(waivers)
      .innerJoin(waiverTemplates, eq(waiverTemplates.id, waivers.templateId))
      .where(eq(waivers.token, input.token))
      .limit(1);
    if (!row) return { ok: false, reason: "not_found" };

    const { waiver, template } = row;
    if (waiver.status !== "pending") {
      // Already signed or referred — immutable, return the stored outcome.
      return { ok: true, status: waiver.status, already: true };
    }
    if (waiver.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

    const questions = template.medicalQuestions;
    if (!signature || !allAnswered(questions, input.answers)) {
      return { ok: false, reason: "incomplete" };
    }

    const answers = pickAnswers(questions, input.answers);
    const status = outcomeStatus(questions, answers);
    await tx
      .update(waivers)
      .set({ status, signature, medicalAnswers: answers, signedAt: now })
      .where(eq(waivers.id, waiver.id));
    return { ok: true, status, already: false };
  });
}

/** A single booking's waiver (for the diver confirmation panel). */
export async function getWaiverForBooking(db: AppDb, shopId: string, bookingId: string) {
  const [row] = await db
    .select()
    .from(waivers)
    .where(and(eq(waivers.shopId, shopId), eq(waivers.bookingId, bookingId)))
    .limit(1);
  return row ?? null;
}

/** Booking-id → waiver, for a whole trip's roster (staff status column). */
export async function getTripWaivers(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<Map<string, typeof waivers.$inferSelect>> {
  const rows = await db
    .select({ waiver: waivers })
    .from(waivers)
    .innerJoin(bookings, eq(bookings.id, waivers.bookingId))
    .where(and(eq(waivers.shopId, shopId), eq(bookings.tripId, tripId)));
  return new Map(rows.map(({ waiver }) => [waiver.bookingId, waiver]));
}

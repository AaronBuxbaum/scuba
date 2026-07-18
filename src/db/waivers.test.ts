// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBooking } from "./bookings";
import { type AppDb, createTestDb } from "./client";
import { getShopBySlug, upcomingTripsWithCounts } from "./queries";
import type { MedicalQuestion } from "./schema";
import { waivers, waiverTemplates } from "./schema";
import { seedDemo } from "./seed";
import {
  getPublishedTemplate,
  getTripWaivers,
  getWaiverByToken,
  getWaiverForBooking,
  issueWaiver,
  submitWaiver,
} from "./waivers";

const QUESTIONS: MedicalQuestion[] = [
  { id: "heart", prompt: "Heart condition?" },
  { id: "asthma", prompt: "Asthma or lung issues?" },
];

const ALL_NO = { heart: false, asthma: false };

async function context() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("open trip missing");
  const booking = await createBooking(db, {
    shopId: shop.id,
    tripId: open.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!booking.ok) throw new Error("setup booking failed");
  return { db, shopId: shop.id, tripId: open.id, bookingId: booking.bookingId };
}

/** Replace the seeded template so tests control the exact medical questions. */
async function useTemplate(db: AppDb, shopId: string) {
  await db
    .update(waiverTemplates)
    .set({ status: "archived" })
    .where(eq(waiverTemplates.shopId, shopId));
  const [t] = await db
    .insert(waiverTemplates)
    .values({
      shopId,
      title: "Test Release",
      body: "I release the shop from liability.",
      medicalQuestions: QUESTIONS,
      version: 99,
      status: "published",
    })
    .returning();
  if (!t) throw new Error("template insert failed");
  return t;
}

describe("issueWaiver", () => {
  it("creates a pending waiver against the published template", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const out = await issueWaiver(db, { shopId, bookingId });
    expect(out).toMatchObject({ ok: true, status: "pending" });
    if (!out.ok) throw new Error("unreachable");

    const w = await getWaiverForBooking(db, shopId, bookingId);
    expect(w?.status).toBe("pending");
    expect(w?.token).toBe(out.token);
  });

  it("is idempotent per booking, refreshing the pending token", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const first = await issueWaiver(db, { shopId, bookingId });
    const second = await issueWaiver(db, { shopId, bookingId });
    if (!first.ok || !second.ok) throw new Error("issue failed");
    expect(second.waiverId).toBe(first.waiverId); // same row
    expect(second.token).not.toBe(first.token); // new link, old one dies

    const all = await db.select().from(waivers).where(eq(waivers.bookingId, bookingId));
    expect(all).toHaveLength(1);
  });

  it("does not re-issue (or mutate) a signed waiver", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const issued = await issueWaiver(db, { shopId, bookingId });
    if (!issued.ok) throw new Error("issue failed");
    await submitWaiver(db, { token: issued.token, signature: "Nora Quinn", answers: ALL_NO });

    const reissued = await issueWaiver(db, { shopId, bookingId });
    if (!reissued.ok) throw new Error("reissue failed");
    expect(reissued.status).toBe("signed");
    expect(reissued.token).toBe(issued.token); // unchanged
  });

  it("fails closed when the shop has no published template", async () => {
    const { db, shopId, bookingId } = await context();
    // Archive the seeded template so none is published.
    await db
      .update(waiverTemplates)
      .set({ status: "archived" })
      .where(eq(waiverTemplates.shopId, shopId));
    const out = await issueWaiver(db, { shopId, bookingId });
    expect(out).toEqual({ ok: false, reason: "no_template" });
  });
});

describe("submitWaiver", () => {
  it("signs when every medical answer is no", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const issued = await issueWaiver(db, { shopId, bookingId });
    if (!issued.ok) throw new Error("issue failed");
    const out = await submitWaiver(db, {
      token: issued.token,
      signature: "  Nora Quinn ",
      answers: ALL_NO,
    });
    expect(out).toEqual({ ok: true, status: "signed", already: false });

    const w = await getWaiverForBooking(db, shopId, bookingId);
    expect(w?.status).toBe("signed");
    expect(w?.signature).toBe("Nora Quinn"); // trimmed
    expect(w?.signedAt).toBeInstanceOf(Date);
  });

  it("fails closed to referral_required on any yes", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const issued = await issueWaiver(db, { shopId, bookingId });
    if (!issued.ok) throw new Error("issue failed");
    const out = await submitWaiver(db, {
      token: issued.token,
      signature: "Nora Quinn",
      answers: { heart: false, asthma: true },
    });
    expect(out).toEqual({ ok: true, status: "referral_required", already: false });
  });

  it("rejects an incomplete medical form (missing answer)", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const issued = await issueWaiver(db, { shopId, bookingId });
    if (!issued.ok) throw new Error("issue failed");
    const out = await submitWaiver(db, {
      token: issued.token,
      signature: "Nora Quinn",
      answers: { heart: false }, // asthma unanswered
    });
    expect(out).toEqual({ ok: false, reason: "incomplete" });
  });

  it("rejects an empty signature", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const issued = await issueWaiver(db, { shopId, bookingId });
    if (!issued.ok) throw new Error("issue failed");
    const out = await submitWaiver(db, { token: issued.token, signature: "   ", answers: ALL_NO });
    expect(out).toEqual({ ok: false, reason: "incomplete" });
  });

  it("rejects an unknown/tampered token", async () => {
    const { db, shopId } = await context();
    await useTemplate(db, shopId);
    const out = await submitWaiver(db, { token: "not-a-real-token", signature: "X", answers: {} });
    expect(out).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an expired link", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const issued = await issueWaiver(db, { shopId, bookingId });
    if (!issued.ok) throw new Error("issue failed");
    await db
      .update(waivers)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(waivers.token, issued.token));
    const out = await submitWaiver(db, {
      token: issued.token,
      signature: "Nora Quinn",
      answers: ALL_NO,
    });
    expect(out).toEqual({ ok: false, reason: "expired" });
  });

  it("is idempotent: a second submit returns the stored outcome, unchanged", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const issued = await issueWaiver(db, { shopId, bookingId });
    if (!issued.ok) throw new Error("issue failed");
    await submitWaiver(db, { token: issued.token, signature: "Nora Quinn", answers: ALL_NO });
    const before = await getWaiverForBooking(db, shopId, bookingId);

    const second = await submitWaiver(db, {
      token: issued.token,
      signature: "Someone Else",
      answers: { heart: true, asthma: true },
    });
    expect(second).toEqual({ ok: true, status: "signed", already: true });

    const after = await getWaiverForBooking(db, shopId, bookingId);
    expect(after?.signature).toBe("Nora Quinn"); // not overwritten
    expect(after?.signedAt?.getTime()).toBe(before?.signedAt?.getTime());
  });
});

describe("queries", () => {
  it("getWaiverByToken joins template, diver, and trip", async () => {
    const { db, shopId, bookingId } = await context();
    await useTemplate(db, shopId);
    const issued = await issueWaiver(db, { shopId, bookingId });
    if (!issued.ok) throw new Error("issue failed");
    const row = await getWaiverByToken(db, issued.token);
    expect(row?.person.fullName).toBe("Nora Quinn");
    expect(row?.template.title).toBe("Test Release");
    expect(row?.trip.title).toBe("Two-Tank Reef — Christ of the Abyss");
  });

  it("getTripWaivers maps booking ids to their waivers", async () => {
    const { db, shopId, tripId, bookingId } = await context();
    await useTemplate(db, shopId);
    await issueWaiver(db, { shopId, bookingId });
    const map = await getTripWaivers(db, shopId, tripId);
    expect(map.get(bookingId)?.status).toBe("pending");
  });

  it("getPublishedTemplate returns the highest-version published row", async () => {
    const { db, shopId } = await context();
    const t = await useTemplate(db, shopId);
    const found = await getPublishedTemplate(db, shopId);
    expect(found?.id).toBe(t.id);
    expect(found?.version).toBe(99);
  });
});

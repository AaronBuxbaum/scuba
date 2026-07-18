import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { type MedicalQuestion, waiverExpiry } from "@/lib/waivers";
import type { AppDb } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import {
  bookings,
  people,
  personRoles,
  shops,
  trips,
  userAccounts,
  waivers,
  waiverTemplates,
} from "./schema";

/**
 * Demo data: one Key Largo shop with staff, customers, and a week of trips.
 * Dates are relative to "now" so the schedule always shows upcoming trips.
 * Dev-only convenience — production seeds nothing (ADR-0005).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** RSTC-style medical statement. A "yes" to any of these needs a physician's sign-off. */
const MEDICAL_QUESTIONS: MedicalQuestion[] = [
  { id: "heart", prompt: "Heart disease, heart attack, or heart surgery?" },
  { id: "lung", prompt: "Asthma, or lung disease requiring treatment?" },
  { id: "meds", prompt: "Prescription medications (other than birth control)?" },
  { id: "surgery", prompt: "Surgery in the last 12 months?" },
  { id: "pregnant", prompt: "Currently pregnant, or trying to become pregnant?" },
];

const RELEASE_BODY = `This Liability Release and Assumption of Risk is entered into by you and Blue Mantis Divers.

Scuba diving involves inherent risks including, but not limited to, decompression sickness, barotrauma, and drowning, which may result in serious injury or death.

By signing, you affirm that you are in good physical and mental health, that you have disclosed any relevant medical condition, and that you assume all risks of participation. You release Blue Mantis Divers, its staff, and crew from liability to the fullest extent permitted by law.

You confirm the information you provide is accurate and that you are the person named below.`;

/** n days from now at the given local-ish hour/minute (UTC-anchored; demo data). */
function at(daysFromNow: number, hour: number, minute = 0): Date {
  const d = new Date(Date.now() + daysFromNow * DAY_MS);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

export async function seedIfEmpty(db: AppDb): Promise<void> {
  const existing = await db.select({ id: shops.id }).from(shops).limit(1);
  if (existing.length > 0) return;
  await seedDemo(db);
}

export async function seedDemo(db: AppDb): Promise<void> {
  const [shop] = await db
    .insert(shops)
    .values({
      name: "Blue Mantis Divers",
      slug: "blue-mantis",
      timezone: "America/New_York",
    })
    .returning();
  if (!shop) throw new Error("seed: failed to insert demo shop");

  const [template] = await db
    .insert(waiverTemplates)
    .values({
      shopId: shop.id,
      title: "Liability Release & Medical Statement",
      body: RELEASE_BODY,
      medicalQuestions: MEDICAL_QUESTIONS,
      version: 1,
      status: "published",
    })
    .returning();
  if (!template) throw new Error("seed: failed to insert waiver template");

  const staffDefs = [
    { fullName: "Dana Reyes", email: "dana@bluemantis.example", roles: ["owner", "manager"] },
    { fullName: "Marcus Webb", email: "marcus@bluemantis.example", roles: ["instructor"] },
    { fullName: "Keiko Tanaka", email: "keiko@bluemantis.example", roles: ["divemaster"] },
    { fullName: "Sal Moretti", email: "sal@bluemantis.example", roles: ["captain"] },
  ] as const;

  const customerNames = [
    "Priya Sharma",
    "Tom Okafor",
    "Lena Fischer",
    "Diego Alvarez",
    "June Park",
    "Omar Haddad",
    "Nadia Petrov",
    "Sam Whitfield",
    "Ines Costa",
    "Ravi Menon",
    "Amara Osei",
    "Felix Grant",
  ];

  const staff = await db
    .insert(people)
    .values(
      staffDefs.map((s) => ({
        shopId: shop.id,
        fullName: s.fullName,
        email: s.email,
        emergencyContactName: "On file",
        emergencyContactPhone: "+1-305-555-0100",
      })),
    )
    .returning();

  await db.insert(personRoles).values(
    staff.flatMap((person, i) =>
      staffDefs[i].roles.map((role) => ({
        personId: person.id,
        role,
      })),
    ),
  );

  // Staff sign-in accounts with deterministic dev passwords (never in prod).
  // Cost 4 keeps seeding fast in tests; real account creation flows must use
  // a production-grade cost.
  const logins = Object.values(DEV_STAFF_LOGINS);
  await db.insert(userAccounts).values(
    await Promise.all(
      logins.map(async (login) => {
        const person = staff.find((p) => p.email === login.email);
        if (!person) throw new Error(`seed: no staff person for ${login.email}`);
        return {
          personId: person.id,
          email: login.email,
          hashedPassword: await hash(login.password, 4),
        };
      }),
    ),
  );

  const customers = await db
    .insert(people)
    .values(
      customerNames.map((fullName, i) => ({
        shopId: shop.id,
        fullName,
        email: `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
        phone: `+1-305-555-01${String(i + 10).padStart(2, "0")}`,
      })),
    )
    .returning();

  await db
    .insert(personRoles)
    .values(customers.map((person) => ({ personId: person.id, role: "customer" as const })));

  const tripRows = await db
    .insert(trips)
    .values([
      {
        shopId: shop.id,
        title: "Two-Tank Reef — Molasses & French",
        description: "Morning double dip on the outer reef. All levels, OW required.",
        startsAt: at(1, 11, 30), // ~7:30 AM Eastern
        endsAt: at(1, 15, 0),
        capacity: 12,
      },
      {
        shopId: shop.id,
        title: "Night Dive — City of Washington",
        description: "Torches, tarpon, and bioluminescence. AOW or Night specialty.",
        startsAt: at(2, 22, 0), // ~6:00 PM Eastern
        endsAt: at(3, 0, 30),
        capacity: 8,
      },
      {
        shopId: shop.id,
        title: "Wreck Trip — Spiegel Grove",
        description: "The big one. AOW + Deep required, nitrox recommended.",
        startsAt: at(5, 12, 0),
        endsAt: at(5, 16, 0),
        capacity: 10,
      },
      {
        shopId: shop.id,
        title: "Two-Tank Reef — Christ of the Abyss",
        description: "Classic shallow sites, great for refreshers and new OW divers.",
        startsAt: at(7, 11, 30),
        endsAt: at(7, 15, 0),
        capacity: 12,
      },
    ])
    .returning();

  // Booking spread: busy reef trip, quiet night dive, sold-out wreck, fresh listing.
  const [reef, night, wreck] = tripRows;
  if (!reef || !night || !wreck) throw new Error("seed: failed to insert demo trips");
  const bookingRows = [
    ...customers.slice(0, 9).map((c) => ({ tripId: reef.id, personId: c.id })),
    ...customers.slice(4, 7).map((c) => ({ tripId: night.id, personId: c.id })),
    ...customers.slice(0, 10).map((c) => ({ tripId: wreck.id, personId: c.id })),
  ];
  const bookingRows_ = await db
    .insert(bookings)
    .values(
      bookingRows.map((row) => ({
        shopId: shop.id,
        status: "booked" as const,
        ...row,
      })),
    )
    .returning();

  await seedWaivers(
    db,
    shop.id,
    template.id,
    bookingRows_.filter((b) => b.tripId === reef.id),
  );
}

const NO_ANSWERS = { heart: false, lung: false, meds: false, surgery: false, pregnant: false };

/** URL-safe completion-link token. */
function token(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * A realistic readiness spread for the reef roster so the staff manage view
 * tells a story: most signed, one awaiting a physician sign-off, the rest still
 * out for signature.
 */
async function seedWaivers(
  db: AppDb,
  shopId: string,
  templateId: string,
  reefBookings: { id: string }[],
): Promise<void> {
  const now = new Date();
  const rows = reefBookings.map((booking, i) => {
    const base = { shopId, bookingId: booking.id, templateId, token: token() };
    if (i < 5) {
      return {
        ...base,
        status: "signed" as const,
        signature: "Signed at booking",
        medicalAnswers: NO_ANSWERS,
        signedAt: now,
        expiresAt: waiverExpiry(now),
      };
    }
    if (i === 5) {
      return {
        ...base,
        status: "referral_required" as const,
        signature: "Signed at booking",
        medicalAnswers: { ...NO_ANSWERS, meds: true },
        signedAt: now,
        expiresAt: waiverExpiry(now),
      };
    }
    return { ...base, status: "pending" as const, expiresAt: waiverExpiry(now) };
  });
  if (rows.length > 0) await db.insert(waivers).values(rows);
}

/**
 * Waiver domain rules, kept framework-free so the diver signing flow, the
 * staff roster, and (later) manifest readiness all agree on what "signed",
 * "referral required", and "expired" mean.
 *
 * Safety invariant (docs/product/next-steps.md Phase B): medical answers fail
 * closed. Any "yes" is a physician-referral trigger — a blocking state, not a
 * ready one — and an unanswered required question can never be signed.
 */

import type { MedicalQuestion } from "@/db/schema";

export type { MedicalQuestion } from "@/db/schema";

/** Diver's yes/no answers keyed by question id. `true` means "yes". */
export type MedicalAnswers = Record<string, boolean>;

/** The terminal state a submitted waiver lands in. Never "pending". */
export type SignedOutcome = "signed" | "referral_required";

/** How long a completion link stays valid. Documented guess — see decisions doc. */
export const WAIVER_LINK_TTL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Expiry timestamp for a freshly issued completion link. */
export function waiverExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + WAIVER_LINK_TTL_DAYS * DAY_MS);
}

export function isWaiverExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Every question must have an explicit boolean answer before signing. */
export function allAnswered(questions: MedicalQuestion[], answers: MedicalAnswers): boolean {
  return questions.every((q) => typeof answers[q.id] === "boolean");
}

/** Ids of questions the diver answered "yes" — the referral triggers. */
export function flaggedMedical(questions: MedicalQuestion[], answers: MedicalAnswers): string[] {
  return questions.filter((q) => answers[q.id] === true).map((q) => q.id);
}

/**
 * Fail closed: any "yes" answer requires a physician referral. A missing
 * answer also counts as needing referral rather than silently passing.
 */
export function needsReferral(questions: MedicalQuestion[], answers: MedicalAnswers): boolean {
  return questions.some((q) => answers[q.id] !== false);
}

/**
 * The terminal status for a fully-answered submission. Callers must reject
 * incomplete submissions (`allAnswered`) before calling this.
 */
export function outcomeStatus(
  questions: MedicalQuestion[],
  answers: MedicalAnswers,
): SignedOutcome {
  return needsReferral(questions, answers) ? "referral_required" : "signed";
}

/** Normalize submitted answers to only the template's known questions. */
export function pickAnswers(questions: MedicalQuestion[], answers: MedicalAnswers): MedicalAnswers {
  const clean: MedicalAnswers = {};
  for (const q of questions) {
    if (typeof answers[q.id] === "boolean") clean[q.id] = answers[q.id];
  }
  return clean;
}

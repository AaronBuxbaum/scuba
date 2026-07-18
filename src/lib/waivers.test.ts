import { describe, expect, it } from "vitest";
import type { MedicalQuestion } from "./waivers";
import {
  allAnswered,
  flaggedMedical,
  isWaiverExpired,
  needsReferral,
  outcomeStatus,
  pickAnswers,
  WAIVER_LINK_TTL_DAYS,
  waiverExpiry,
} from "./waivers";

const questions: MedicalQuestion[] = [
  { id: "heart", prompt: "Heart condition?" },
  { id: "asthma", prompt: "Asthma or lung issues?" },
  { id: "meds", prompt: "Prescription medication?" },
];

describe("waiver medical rules", () => {
  it("treats all-no as signable and not referral", () => {
    const answers = { heart: false, asthma: false, meds: false };
    expect(allAnswered(questions, answers)).toBe(true);
    expect(needsReferral(questions, answers)).toBe(false);
    expect(flaggedMedical(questions, answers)).toEqual([]);
    expect(outcomeStatus(questions, answers)).toBe("signed");
  });

  it("flags any yes as needing referral (fail closed)", () => {
    const answers = { heart: false, asthma: true, meds: false };
    expect(needsReferral(questions, answers)).toBe(true);
    expect(flaggedMedical(questions, answers)).toEqual(["asthma"]);
    expect(outcomeStatus(questions, answers)).toBe("referral_required");
  });

  it("treats a missing answer as not-yet-answerable and needing referral", () => {
    const answers = { heart: false, asthma: false }; // meds unanswered
    expect(allAnswered(questions, answers)).toBe(false);
    // Fail closed: an incomplete form is never silently "signed".
    expect(needsReferral(questions, answers)).toBe(true);
  });

  it("has no questions => trivially signable, no referral", () => {
    expect(allAnswered([], {})).toBe(true);
    expect(needsReferral([], {})).toBe(false);
    expect(outcomeStatus([], {})).toBe("signed");
  });

  it("ignores stray answers not in the template", () => {
    const answers = { heart: false, asthma: false, meds: false, injected: true };
    expect(pickAnswers(questions, answers)).toEqual({
      heart: false,
      asthma: false,
      meds: false,
    });
    // The stray "yes" must not leak into the referral decision.
    expect(needsReferral(questions, pickAnswers(questions, answers))).toBe(false);
  });
});

describe("waiver expiry", () => {
  it("computes a TTL window from the issue time", () => {
    const from = new Date("2026-07-18T00:00:00Z");
    const expires = waiverExpiry(from);
    const days = (expires.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(WAIVER_LINK_TTL_DAYS);
  });

  it("is expired at or after the boundary", () => {
    const expiresAt = new Date("2026-07-18T00:00:00Z");
    expect(isWaiverExpired(expiresAt, new Date("2026-07-17T23:59:59Z"))).toBe(false);
    expect(isWaiverExpired(expiresAt, expiresAt)).toBe(true);
    expect(isWaiverExpired(expiresAt, new Date("2026-07-18T00:00:01Z"))).toBe(true);
  });
});

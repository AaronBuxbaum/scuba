import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/db/client";
import { getWaiverByToken, submitWaiver } from "@/db/waivers";
import { formatShortDate, formatTimeRange } from "@/lib/format";
import type { MedicalAnswers } from "@/lib/waivers";
import { isWaiverExpired } from "@/lib/waivers";

export const metadata: Metadata = {
  title: "Your dive waiver — Scuba",
};

const ERRORS: Record<string, string> = {
  incomplete: "Almost there — answer every question, sign your name, and tick the acknowledgement.",
  expired: "This link has expired. Ask the shop to send you a fresh one.",
};

export default async function WaiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { error } = await searchParams;
  const db = await getDb();
  const row = await getWaiverByToken(db, token);
  if (!row) notFound();

  const { waiver, template, person, trip } = row;
  const firstName = person.fullName.split(" ")[0];
  const when = `${formatShortDate(trip.startsAt, "en-US")} · ${formatTimeRange(
    trip.startsAt,
    trip.endsAt,
    "en-US",
  )}`;

  async function sign(formData: FormData) {
    "use server";
    const dbi = await getDb();
    const current = await getWaiverByToken(dbi, token);
    if (!current) redirect(`/waiver/${token}?error=incomplete`);
    const answers: MedicalAnswers = {};
    for (const q of current.template.medicalQuestions) {
      const v = formData.get(`q_${q.id}`);
      if (v === "yes") answers[q.id] = true;
      else if (v === "no") answers[q.id] = false;
    }
    const acknowledged = formData.get("ack") === "on";
    const signature = String(formData.get("signature") ?? "");
    if (!acknowledged) redirect(`/waiver/${token}?error=incomplete`);
    const outcome = await submitWaiver(dbi, { token, signature, answers });
    if (!outcome.ok) redirect(`/waiver/${token}?error=${outcome.reason}`);
    redirect(`/waiver/${token}`);
  }

  // Terminal states render from the stored row, never a URL claim.
  if (waiver.status === "signed") {
    return (
      <Shell shopFirst={firstName}>
        <section className="rise-in mt-8 rounded-lg border border-accent/40 bg-accent/10 p-6">
          <h1 className="text-2xl font-semibold text-balance">All set, {firstName}. 🤿</h1>
          <p className="mt-2 text-muted">
            Your waiver for <strong>{trip.title}</strong> is signed and on file. Nothing else to do
            — just be at the dock 30 minutes before {when}.
          </p>
        </section>
      </Shell>
    );
  }

  if (waiver.status === "referral_required") {
    return (
      <Shell shopFirst={firstName}>
        <section className="mt-8 rounded-lg border border-warning/50 bg-warning/10 p-6">
          <h1 className="text-2xl font-semibold text-balance">One quick step first, {firstName}</h1>
          <p className="mt-3 text-foreground">
            Thanks for answering honestly. Based on your medical answers, dive-industry rules ask
            for a physician's sign-off before you dive — it's a routine safety check, not a no.
          </p>
          <p className="mt-3 text-muted">
            Bring a completed, signed medical examination form (RSTC) to check-in, or contact the
            shop and we'll walk you through it. Your answers are saved; you don't need this link
            again.
          </p>
        </section>
      </Shell>
    );
  }

  if (isWaiverExpired(waiver.expiresAt)) {
    return (
      <Shell shopFirst={firstName}>
        <section className="mt-8 rounded-lg border border-border bg-surface p-6">
          <h1 className="text-xl font-semibold">This link has expired</h1>
          <p className="mt-2 text-sm text-muted">
            No problem — ask the shop to text or email you a fresh waiver link and you'll be signed
            in a minute.
          </p>
        </section>
      </Shell>
    );
  }

  const errorMessage = error ? ERRORS[error] : undefined;
  const inputClass =
    "min-h-11 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base font-normal";

  return (
    <Shell shopFirst={firstName}>
      <FlashParams params={["error"]} />
      <header className="mt-6">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          Let's get you dive-ready, {firstName}
        </h1>
        <p className="mt-2 text-muted">
          {trip.title} — {when}. Two minutes now saves the queue at the dock.
        </p>
      </header>

      {errorMessage ? (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      ) : null}

      <form action={sign} className="mt-8 flex flex-col gap-8">
        <section>
          <h2 className="text-lg font-semibold">Liability release</h2>
          <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-border bg-surface-sunken p-4 text-sm whitespace-pre-line text-foreground">
            {template.body}
          </div>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input type="checkbox" name="ack" className="mt-1 size-4 accent-primary" required />
            <span>
              I have read and agree to this release, and I confirm I'm signing as{" "}
              <strong>{person.fullName}</strong>.
            </span>
          </label>
        </section>

        {template.medicalQuestions.length > 0 ? (
          <section>
            <h2 className="text-lg font-semibold">Medical statement</h2>
            <p className="mt-1 text-sm text-muted">
              Answer honestly. A “yes” isn't a no — it just means we'll ask for a doctor's sign-off,
              which keeps everyone safe.
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {template.medicalQuestions.map((q) => (
                <li
                  key={q.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm"
                >
                  <span className="min-w-0 flex-1">{q.prompt}</span>
                  <span className="flex shrink-0 gap-4">
                    <label className="flex min-h-11 items-center gap-2 font-medium">
                      <input
                        type="radio"
                        name={`q_${q.id}`}
                        value="no"
                        required
                        className="size-4 accent-primary"
                      />
                      No
                    </label>
                    <label className="flex min-h-11 items-center gap-2 font-medium">
                      <input
                        type="radio"
                        name={`q_${q.id}`}
                        value="yes"
                        className="size-4 accent-primary"
                      />
                      Yes
                    </label>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <label className="flex flex-col gap-1 text-base font-medium">
            Signature — type your full legal name
            <input
              name="signature"
              type="text"
              required
              maxLength={120}
              autoComplete="name"
              defaultValue={person.fullName}
              className={inputClass}
            />
          </label>
        </section>

        <div>
          <SubmitButton
            pendingLabel="Signing…"
            className="min-h-11 rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover disabled:opacity-70"
          >
            Sign my waiver
          </SubmitButton>
        </div>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode; shopFirst: string }) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <p className="text-sm font-medium tracking-widest text-primary uppercase">Dive waiver</p>
      {children}
      <p className="mt-10 text-xs text-muted">
        Signed waivers are stored securely and can't be edited after signing.{" "}
        <Link href="/trips" className="font-medium text-primary hover:underline">
          Back to trips
        </Link>
      </p>
    </main>
  );
}

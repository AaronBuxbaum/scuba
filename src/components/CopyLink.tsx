"use client";

import { useState } from "react";

/**
 * Copies an absolute URL (built from a path + the current origin) to the
 * clipboard, with a brief "Copied" confirmation. Staff hand these waiver links
 * to divers by text/email, so the common action is copy, not navigate.
 */
export function CopyLink({ path, label = "Copy link" }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this waiver link:", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
      aria-live="polite"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

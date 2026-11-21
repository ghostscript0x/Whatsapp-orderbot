"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/fetcher";

export type SaveState = { status: "idle" | "saving" | "saved" | "error"; message?: string };

/** PUTs JSON and tracks saving / saved / error for a form. */
export function useSave<T>(url: string) {
  const [state, setState] = useState<SaveState>({ status: "idle" });

  async function save(body: unknown): Promise<T | null> {
    setState({ status: "saving" });
    try {
      const res = await apiFetch<T>(url, { method: "PUT", json: body });
      setState({ status: "saved" });
      return res;
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Could not save" });
      return null;
    }
  }

  return { state, save, reset: () => setState({ status: "idle" }) };
}

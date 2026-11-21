import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let getImpl: (key: string) => Promise<string | null> = async (key) => store.get(key) ?? null;
const setCalls: unknown[][] = [];

vi.mock("@/lib/redis", () => ({
  redis: () => ({
    get: (key: string) => getImpl(key),
    set: async (...args: unknown[]) => {
      setCalls.push(args);
      store.set(args[0] as string, args[1] as string);
      return "OK";
    },
    del: async (key: string) => Number(store.delete(key)),
  }),
}));

import { clearWorkerHeartbeat, getSystemStatus, writeWorkerHeartbeat, WORKER_HEARTBEAT_KEY } from "@/lib/system-status";

beforeEach(() => {
  store.clear();
  setCalls.length = 0;
  getImpl = async (key) => store.get(key) ?? null;
});

describe("worker heartbeat", () => {
  it("writes the ISO time under worker:heartbeat with a 45 s TTL", async () => {
    await writeWorkerHeartbeat(new Date("2026-11-21T10:00:00.000Z"));
    expect(setCalls).toEqual([["worker:heartbeat", "2026-11-21T10:00:00.000Z", "EX", 45]]);
    expect(await getSystemStatus()).toEqual({ workerOnline: true, lastHeartbeatAt: "2026-11-21T10:00:00.000Z" });
  });

  it("reports offline when there is no heartbeat or it was cleared", async () => {
    expect(await getSystemStatus()).toEqual({ workerOnline: false, lastHeartbeatAt: null });
    store.set(WORKER_HEARTBEAT_KEY, "2026-11-21T10:00:00.000Z");
    await clearWorkerHeartbeat();
    expect((await getSystemStatus()).workerOnline).toBe(false);
  });

  it("reports offline instead of throwing when Redis fails or hangs", async () => {
    getImpl = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await getSystemStatus()).toEqual({ workerOnline: false, lastHeartbeatAt: null });

    vi.useFakeTimers();
    getImpl = () => new Promise(() => {});
    const pending = getSystemStatus();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ workerOnline: false, lastHeartbeatAt: null });
    vi.useRealTimers();
  });
});

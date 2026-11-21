import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

const INTERVAL_MS = 10 * 60 * 1000;
export const AUTO_RESUME_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Resumes the bot on conversations paused for 12h with no staff reply in that time,
 * i.e. max(botPausedAt, lastStaffReplyAt) older than the cutoff (null counts as old).
 *
 * Uses the RAW prisma client on purpose: this is a platform-wide sweep across all tenants,
 * it only touches rows matching the pause condition, and it reads/returns no tenant data.
 * needsHuman is left as-is so unresolved requests stay visible in the inbox.
 */
export async function resumeStalePausedBots(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUTO_RESUME_AFTER_MS);
  const { count } = await prisma.conversation.updateMany({
    where: {
      botPaused: true,
      AND: [
        { OR: [{ botPausedAt: null }, { botPausedAt: { lt: cutoff } }] },
        { OR: [{ lastStaffReplyAt: null }, { lastStaffReplyAt: { lt: cutoff } }] },
      ],
    },
    data: { botPaused: false, botPausedAt: null },
  });
  return count;
}

export function startMaintenance(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const resumed = await resumeStalePausedBots();
      if (resumed > 0) logger.info({ resumed }, "auto-resumed bots after 12h without staff reply");
    } catch (err) {
      logger.error({ err }, "maintenance: auto-resume failed; will retry next interval");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  return () => clearInterval(timer);
}

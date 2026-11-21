import nodemailer from "nodemailer";
import { env } from "./env";
import { logger } from "./logger";

let transport: nodemailer.Transporter | undefined;

/**
 * Sends an email via SMTP_URL. When SMTP_URL is not set (local dev), the email is
 * written to the log instead, clearly marked, so links (reset/invite) can still be used.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const { SMTP_URL, EMAIL_FROM } = env();
  if (!SMTP_URL) {
    logger.warn({ to, subject, text }, "SMTP_URL not set: email NOT sent, logged instead");
    return;
  }
  transport ??= nodemailer.createTransport(SMTP_URL);
  await transport.sendMail({ from: EMAIL_FROM, to, subject, text });
}

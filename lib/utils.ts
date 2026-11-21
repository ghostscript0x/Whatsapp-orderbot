import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** WhatsApp chat id ("2348012345678@c.us") -> digits ("2348012345678"). */
export function phoneFromChatId(chatId: string): string {
  return chatId.split("@")[0].replace(/\D/g, "");
}

/** Phone digits -> WhatsApp 1:1 chat id. */
export function chatIdFromPhone(phone: string): string {
  return `${phone.replace(/\D/g, "")}@c.us`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

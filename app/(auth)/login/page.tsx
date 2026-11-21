import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { safeCallbackUrl } from "@/components/shell/safe-callback";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  if ((await auth())?.user?.id) redirect(callbackUrl);
  const reset = params.reset === "1";
  return <LoginForm callbackUrl={callbackUrl} passwordReset={reset} />;
}

"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export function SignOutButton({ redirectTo = "/login", ...props }: { redirectTo?: string } & Omit<ButtonProps, "onClick">) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      {...props}
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signOut({ redirectTo });
      }}
    >
      <LogOut aria-hidden />
      {pending ? "Logging out…" : "Log out"}
    </Button>
  );
}

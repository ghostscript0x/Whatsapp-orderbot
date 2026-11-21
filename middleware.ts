import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Page routes only; API routes do their own auth and return JSON errors.
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};

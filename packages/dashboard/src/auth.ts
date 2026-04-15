/**
 * Auth.js v5 configuration for Steed Dashboard.
 *
 * Uses JWT strategy with Google OAuth.
 * Access controlled via email whitelist (ADMIN_EMAILS).
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** Determine whether to use __Secure- prefixed cookies. */
function shouldUseSecureCookies(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NEXTAUTH_URL?.startsWith("https://") === true ||
    process.env.USE_SECURE_COOKIES === "true"
  );
}

const useSecureCookies = shouldUseSecureCookies();

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Must be true for reverse proxy: Auth.js needs to read
  // X-Forwarded-Host to match the session cookie domain.
  trustHost: true,
  providers: [Google],
  session: { strategy: "jwt" },
  // Cookie configuration for reverse proxy environments
  cookies: {
    pkceCodeVerifier: {
      name: useSecureCookies
        ? "__Secure-authjs.pkce.code_verifier"
        : "authjs.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    state: {
      name: useSecureCookies ? "__Secure-authjs.state" : "authjs.state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: useSecureCookies
        ? "__Secure-authjs.callback-url"
        : "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    sessionToken: {
      name: useSecureCookies
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: useSecureCookies
        ? "__Host-authjs.csrf-token"
        : "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  callbacks: {
    async signIn({ profile }) {
      // Whitelist check: only allowed emails can sign in
      const email = profile?.email?.toLowerCase();
      if (!email || !ADMIN_EMAILS.includes(email)) {
        return false; // Reject
      }
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});

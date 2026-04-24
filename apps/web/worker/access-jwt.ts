import type { JWTPayload } from "jose";
import * as jose from "jose";

export type VerifyResult =
  | { ok: true; user: { email: string; sub: string } }
  | { ok: false; reason: string };

export interface VerifyOptions {
  team: string;
  aud: string;
  devBypass?: boolean;
}

interface CfAccessCertResponse {
  keys: jose.JWK[];
}

const certsCache = new Map<string, { jwks: jose.JSONWebKeySet; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getCerts(team: string): Promise<jose.JSONWebKeySet> {
  const cached = certsCache.get(team);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.jwks;
  }

  const certsUrl = `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(certsUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch certs: ${res.status}`);
  }

  const data = (await res.json()) as CfAccessCertResponse;
  const jwks: jose.JSONWebKeySet = { keys: data.keys };

  certsCache.set(team, { jwks, expiresAt: now + CACHE_TTL_MS });
  return jwks;
}

export async function verifyAccessJwt(
  req: Request,
  opts: VerifyOptions
): Promise<VerifyResult> {
  if (opts.devBypass) {
    return { ok: true, user: { email: "dev@local", sub: "dev" } };
  }

  const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) {
    return { ok: false, reason: "Missing Cf-Access-Jwt-Assertion header" };
  }

  try {
    const issuer = `https://${opts.team}.cloudflareaccess.com`;
    const jwks = await getCerts(opts.team);
    const keySet = jose.createLocalJWKSet(jwks);

    const { payload } = await jose.jwtVerify<JWTPayload & { email?: string }>(jwt, keySet, {
      issuer,
      audience: opts.aud,
    });

    const email = payload.email ?? "";
    const sub = payload.sub ?? "";

    if (!sub) {
      return { ok: false, reason: "Missing sub claim" };
    }

    return { ok: true, user: { email, sub } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, reason: message };
  }
}

/**
 * CLI OAuth Login Endpoint
 *
 * Flow:
 * 1. CLI starts local server, opens browser to this endpoint
 * 2. This endpoint checks Google OAuth session
 * 3. If authenticated, registers/gets host via Worker API
 * 4. Redirects back to CLI callback with api_key and worker_url
 *
 * Security:
 * - Only accepts callback URLs pointing to localhost/127.0.0.1
 * - Validates state parameter for CSRF protection
 * - Hostname is provided by CLI (the machine initiating login)
 */

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { workerApi, getWorkerApiUrl } from "@/lib/worker-api";

/**
 * Validate that callback URL is a localhost address
 */
function isLocalhostCallback(callbackUrl: string): boolean {
  try {
    const url = new URL(callbackUrl);
    // Only allow localhost or 127.0.0.1
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * Build error redirect URL with error message
 */
function errorRedirect(callbackUrl: string, state: string, error: string): string {
  const url = new URL(callbackUrl);
  url.searchParams.set("error", error);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Build success redirect URL with api_key and worker_url
 */
function successRedirect(
  callbackUrl: string,
  state: string,
  apiKey: string,
  workerUrl: string,
  email?: string | null
): string {
  const url = new URL(callbackUrl);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("worker_url", workerUrl);
  url.searchParams.set("state", state);
  if (email) {
    url.searchParams.set("email", email);
  }
  return url.toString();
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const callbackUrl = url.searchParams.get("callback");
  const state = url.searchParams.get("state");
  const hostName = url.searchParams.get("hostname");

  // Validate required parameters
  if (!callbackUrl || !state) {
    return new Response("Missing required parameters: callback and state", {
      status: 400,
    });
  }

  // Hostname must be provided by CLI (the machine initiating login)
  if (!hostName) {
    return new Response("Missing required parameter: hostname", {
      status: 400,
    });
  }

  // Security: only allow localhost callbacks
  if (!isLocalhostCallback(callbackUrl)) {
    return new Response("Invalid callback URL: must be localhost", {
      status: 400,
    });
  }

  // Check authentication
  const session = await auth();
  if (!session?.user?.email) {
    // Store callback info and redirect to login
    // After login, user will need to re-initiate the flow
    // For simplicity, we redirect to login with a return URL
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("callbackUrl", request.url);
    return redirect(loginUrl.toString());
  }

  // Register host with Worker API using CLI-provided hostname
  try {
    const result = await workerApi.hosts.register(hostName);

    // Get the actual Worker URL from environment
    const workerUrl = getWorkerApiUrl();

    // Redirect to CLI callback with api_key and worker_url
    return redirect(
      successRedirect(callbackUrl, state, result.api_key, workerUrl, session.user.email)
    );
  } catch (error) {
    // Re-throw Next.js redirect errors (they use throw for control flow)
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    // Redirect to CLI callback with error
    const message = error instanceof Error ? error.message : "Failed to register host";
    return redirect(errorRedirect(callbackUrl, state, message));
  }
}

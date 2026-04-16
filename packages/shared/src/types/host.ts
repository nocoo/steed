/**
 * Host — a machine running the Host Service + CLI
 */
export interface Host {
  id: string;
  name: string;
  api_key_hash: string;
  created_at: string;
  last_seen_at: string | null;
}

/**
 * Host with computed online status (for API responses)
 */
export interface HostWithStatus extends Host {
  status: "online" | "offline";
}

/**
 * Request payload for registering a new host
 */
export interface RegisterHostRequest {
  name: string;
}

/**
 * Response payload after registering a host
 * Note: api_key is only returned once at registration
 */
export interface RegisterHostResponse {
  id: string;
  name: string;
  api_key: string;
}

/**
 * Response payload for verifying host API key
 */
export interface VerifyAuthResponse {
  valid: boolean;
  host_id: string;
  host_name: string;
}

import type {
  LocalAgentSnapshot,
  LocalDataSourceSnapshot,
  LocalSnapshotResponse,
} from "../config/schema.js";
import { HttpClient, NetworkError, ApiError, AuthError } from "../lib/http.js";

/**
 * Snapshot request payload
 */
export interface SnapshotRequest {
  agents: LocalAgentSnapshot[];
  data_sources: LocalDataSourceSnapshot[];
}

/**
 * Report result
 */
export interface ReportResult {
  success: boolean;
  response?: LocalSnapshotResponse;
  error?: {
    type: "network" | "auth" | "api";
    message: string;
  };
}

/**
 * Reporter for sending snapshots to Worker API
 */
export class Reporter {
  private client: HttpClient;

  constructor(baseUrl: string, apiKey: string, timeout: number = 30000) {
    this.client = new HttpClient(baseUrl, apiKey, timeout);
  }

  /**
   * Send snapshot to Worker
   */
  async report(
    agents: LocalAgentSnapshot[],
    dataSources: LocalDataSourceSnapshot[]
  ): Promise<ReportResult> {
    const payload: SnapshotRequest = {
      agents,
      data_sources: dataSources,
    };

    try {
      const response = await this.client.post<LocalSnapshotResponse>(
        "/api/v1/snapshot",
        payload
      );

      return {
        success: true,
        response,
      };
    } catch (err) {
      if (err instanceof AuthError) {
        return {
          success: false,
          error: {
            type: "auth",
            message: err.message,
          },
        };
      }

      if (err instanceof ApiError) {
        return {
          success: false,
          error: {
            type: "api",
            message: `${err.code}: ${err.message}`,
          },
        };
      }

      if (err instanceof NetworkError) {
        return {
          success: false,
          error: {
            type: "network",
            message: err.message,
          },
        };
      }

      return {
        success: false,
        error: {
          type: "network",
          message: err instanceof Error ? err.message : "Unknown error",
        },
      };
    }
  }
}

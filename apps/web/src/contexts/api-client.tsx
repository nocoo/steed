import { createContext, useContext, useMemo } from "react";
import { createApiClient, type ApiClient } from "@steed/api/client";

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiClientProviderProps {
  children: React.ReactNode;
  baseUrl?: string;
}

export function ApiClientProvider({
  children,
  baseUrl = "/api",
}: ApiClientProviderProps) {
  const client = useMemo(
    () => createApiClient({ baseUrl }),
    [baseUrl]
  );

  return (
    <ApiClientContext value={client}>
      {children}
    </ApiClientContext>
  );
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error("useApiClient must be used within ApiClientProvider");
  }
  return client;
}

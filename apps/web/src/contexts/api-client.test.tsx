import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApiClientProvider, useApiClient } from "./api-client";

function TestConsumer() {
  const client = useApiClient();
  return <div data-testid="has-client">{client ? "yes" : "no"}</div>;
}

describe("ApiClientProvider", () => {
  it("provides ApiClient to children", () => {
    render(
      <ApiClientProvider>
        <TestConsumer />
      </ApiClientProvider>
    );

    expect(screen.getByTestId("has-client")).toHaveTextContent("yes");
  });

  it("throws when useApiClient is used outside provider", () => {
    const consoleError = console.error;
    console.error = () => {};

    expect(() => render(<TestConsumer />)).toThrow(
      "useApiClient must be used within ApiClientProvider"
    );

    console.error = consoleError;
  });

  it("accepts custom baseUrl", () => {
    render(
      <ApiClientProvider baseUrl="https://api.example.com">
        <TestConsumer />
      </ApiClientProvider>
    );

    expect(screen.getByTestId("has-client")).toHaveTextContent("yes");
  });
});

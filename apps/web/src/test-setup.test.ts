import { expect, test } from "vitest";

test("DOM matchers preserve rejected error messages", async () => {
  expect(document.body).toBeInTheDocument();
  await expect(Promise.reject(new Error("expected error"))).rejects.toThrow("expected error");
});

import { describe, expect, it } from "vitest";
import { avatarSchema, userProfileSchema } from "./profile";

describe("profile schema", () => {
  it.each([
    "https://images.example.com/a.png",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
    null,
  ])("accepts %s", (value) => expect(avatarSchema.safeParse(value).success).toBe(true));

  it.each([
    "http://images.example.com/a.png",
    "https://user:pass@images.example.com/a.png",
    `https://example.com/${"a".repeat(2048)}`,
    "data:image/png;base64,",
    "data:image/png;base64,abc",
    "data:image/svg+xml;base64,PHN2Zz4=",
    `data:image/png;base64,${"A".repeat(16_384)}`,
    "javascript:alert(1)",
  ])("rejects %s", (value) => expect(avatarSchema.safeParse(value).success).toBe(false));

  it("validates a full profile", () => {
    expect(userProfileSchema.parse({ email: null, name: " Zheng Li ", avatar: null })).toEqual({ email: null, name: "Zheng Li", avatar: null });
  });
});

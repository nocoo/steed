import { z } from "zod";

export const userProfileSchema = z.object({
  email: z.string().nullable(),
  name: z.string().trim().min(1).max(200),
  avatar: z.url({ protocol: /^https$/ }).max(2048).nullable(),
});

export type UserProfile = z.infer<typeof userProfileSchema>;

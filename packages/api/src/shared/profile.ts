import { z } from "zod";

const PNG_DATA_URL = /^data:image\/png;base64,(?=[A-Za-z0-9+/])(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const httpsAvatar = z.url({ protocol: /^https$/ }).max(2048)
  .refine((value) => { const url = new URL(value); return !url.username && !url.password; });

/** An avatar is an https URL without credentials or a small base64 PNG data URL. */
export const avatarSchema = z.union([httpsAvatar, z.string().max(16_384).regex(PNG_DATA_URL)]).nullable();

export const userProfileSchema = z.object({
  email: z.string().nullable(),
  name: z.string().trim().min(1).max(200),
  avatar: avatarSchema,
});

export type UserProfile = z.infer<typeof userProfileSchema>;

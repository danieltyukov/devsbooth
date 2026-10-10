/** Input rules shared by server validation and client forms. */
export const LIMITS = {
  emailMax: 254,
  codeLength: 6,
  nameMax: 50,
  usernameMin: 3,
  usernameMax: 20,
  bioMax: 160,
  topicMin: 3,
  topicMax: 100,
  avatarBytesMax: 5 * 1024 * 1024,
} as const;

/** Lowercase letters, digits and underscores. Usernames are stored lowercase. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export const ROOM_TYPES = ['open', 'social', 'private'] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

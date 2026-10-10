import type { Me, UserSummary } from '@devsbooth/shared';
import type { UserFields } from '../models/user';

type UserLike = Pick<UserFields, 'email' | 'username' | 'name' | 'bio' | 'avatar' | 'createdAt'> & {
  _id: { toString(): string };
};

export const AVATAR_ROUTE = '/uploads/avatars';

export function avatarUrl(user: Pick<UserFields, 'avatar'>): string | null {
  return user.avatar ? `${AVATAR_ROUTE}/${user.avatar}` : null;
}

export function toMe(user: UserLike): Me {
  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username ?? null,
    name: user.name ?? null,
    bio: user.bio ?? '',
    avatarUrl: avatarUrl(user),
    onboarded: Boolean(user.username && user.name),
    createdAt: user.createdAt.toISOString(),
  };
}

export function toSummary(user: Omit<UserLike, 'email' | 'bio' | 'createdAt'>): UserSummary {
  return {
    id: user._id.toString(),
    username: user.username ?? '',
    name: user.name ?? '',
    avatarUrl: avatarUrl(user),
  };
}

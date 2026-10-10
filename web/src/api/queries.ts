import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientConfig, Me, Profile, RoomSummary } from '@devsbooth/shared';
import { api, ApiError } from './client';

export const keys = {
  me: ['me'] as const,
  config: ['config'] as const,
  rooms: (q: string) => ['rooms', q] as const,
  room: (id: string) => ['room', id] as const,
  profile: (username: string) => ['profile', username.toLowerCase()] as const,
  hosted: (username: string) => ['hosted', username.toLowerCase()] as const,
};

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return (await api<{ user: Me }>('/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useSetMe() {
  const client = useQueryClient();
  return (user: Me | null) => client.setQueryData(keys.me, user);
}

export function useClientConfig() {
  return useQuery({
    queryKey: keys.config,
    queryFn: () => api<ClientConfig>('/config'),
    staleTime: Infinity,
  });
}

export function useRooms(q: string) {
  return useQuery({
    queryKey: keys.rooms(q),
    queryFn: async ({ signal }): Promise<RoomSummary[]> => {
      const res = await api<{ rooms: RoomSummary[] }>(`/rooms${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
        signal,
      });
      return res.rooms;
    },
    // Live counts change as people come and go.
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });
}

export function useProfile(username: string) {
  return useQuery({
    queryKey: keys.profile(username),
    queryFn: () =>
      api<{ profile: Profile }>(`/users/${encodeURIComponent(username)}`).then((res) => res.profile),
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
  });
}

/** Live rooms a person hosts, as far as you may see them. */
export function useHostedRooms(username: string) {
  return useQuery({
    queryKey: keys.hosted(username),
    queryFn: async (): Promise<RoomSummary[]> =>
      (await api<{ rooms: RoomSummary[] }>(`/users/${encodeURIComponent(username)}/rooms`)).rooms,
    refetchInterval: 15_000,
  });
}

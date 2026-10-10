import type { RoomType } from './limits';

/** Returned when a sign-in code is sent. The browser sends it back with the code. */
export interface CodeChallenge {
  challenge: string;
}

export interface UserSummary {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
}

/** The signed-in user. `username` and `name` are null until onboarding is done. */
export interface Me {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  bio: string;
  avatarUrl: string | null;
  onboarded: boolean;
  createdAt: string;
}

export interface Profile extends UserSummary {
  bio: string;
  followers: number;
  following: number;
  isFollowing: boolean;
  isMe: boolean;
  createdAt: string;
}

export interface RoomSummary {
  id: string;
  topic: string;
  type: RoomType;
  owner: UserSummary;
  speakers: UserSummary[];
  participantCount: number;
  createdAt: string;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface ClientConfig {
  iceServers: IceServer[];
  maxParticipants: number;
}

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'too_many_requests'
  | 'code_invalid'
  | 'code_expired'
  | 'room_ended'
  | 'room_full'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'internal';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}

import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { log } from '../log';

/**
 * A selective forwarding unit carries the audio instead of the browser mesh: each speaker uploads
 * once and the SFU sends it to everyone. DevsBooth uses LiveKit. Roles are enforced by the SFU
 * itself, through each participant's publish permission.
 */
export interface SfuGateway {
  /** The address browsers connect to. */
  readonly url: string;
  /** A token to join `roomId` as `peerId`. Only speakers may publish, and only a microphone. */
  token(input: { roomId: string; peerId: string; name: string; canPublish: boolean }): Promise<string>;
  /** Changes what a connected participant may do; the SFU unpublishes tracks when publishing is revoked. */
  setCanPublish(roomId: string, peerId: string, canPublish: boolean): Promise<void>;
  /** Drops a participant from the SFU, for example a tab that another tab replaced. */
  removePeer(roomId: string, peerId: string): Promise<void>;
  /** Disconnects everyone and closes the room on the SFU. */
  closeRoom(roomId: string): Promise<void>;
}

export interface LivekitConfig {
  url: string;
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

const TOKEN_TTL = '6h';

function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number; code?: string }).status;
  const code = (err as { code?: string }).code;
  return status === 404 || code === 'not_found';
}

export function livekitGateway(config: LivekitConfig): SfuGateway {
  const service = new RoomServiceClient(config.apiUrl, config.apiKey, config.apiSecret);
  const permission = (canPublish: boolean) => ({
    canSubscribe: true,
    canPublish,
    canPublishData: false,
    canPublishSources: [TrackSource.MICROPHONE],
    canUpdateMetadata: false,
  });

  return {
    url: config.url,

    async token({ roomId, peerId, name, canPublish }) {
      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity: peerId,
        name,
        ttl: TOKEN_TTL,
      });
      token.addGrant({
        room: roomId,
        roomJoin: true,
        canSubscribe: true,
        canPublish,
        canPublishData: false,
        canPublishSources: [TrackSource.MICROPHONE],
        canUpdateOwnMetadata: false,
      });
      return token.toJwt();
    },

    async setCanPublish(roomId, peerId, canPublish) {
      try {
        await service.updateParticipant(roomId, peerId, undefined, permission(canPublish));
      } catch (err) {
        // Not connected to the SFU yet: the fresh token sent with the role change covers it.
        if (!isNotFound(err)) throw err;
      }
    },

    async removePeer(roomId, peerId) {
      try {
        await service.removeParticipant(roomId, peerId);
      } catch (err) {
        if (!isNotFound(err)) log.warn('Could not remove a participant from the SFU', { err });
      }
    },

    async closeRoom(roomId) {
      try {
        await service.deleteRoom(roomId);
      } catch (err) {
        if (!isNotFound(err)) log.warn('Could not close the room on the SFU', { err });
      }
    },
  };
}

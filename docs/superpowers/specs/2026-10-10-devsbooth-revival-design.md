# DevsBooth revival: design

Date: 2026-10-10. Status: approved (stack, sign-in, branch and publishing decisions taken with the maintainer).

## Goal

Bring DevsBooth back as a community open-source project: drop-in audio rooms for developers that anyone can self-host with one compose file and no third-party accounts. The 2022 code is a half-finished tutorial port that does not run; this is a rewrite that delivers every feature in the original requirements list, with tests at every layer and the repository kit used by the maintainer's other open-source projects.

Success means:

- `docker compose up` gives a working instance; `npm run dev` gives a working dev setup with no accounts and no SMTP.
- Two people can sign in, meet in a room and hear each other, and CI proves it with a two-browser Playwright test that asserts audio is flowing.
- A new contributor can read the README, CONTRIBUTING and ARCHITECTURE and land a change.

## Decisions

| Topic | Decision |
| --- | --- |
| Language | TypeScript everywhere, ESM, Node 22 or newer |
| Layout | npm workspaces: `server`, `web`, `shared`, `e2e` |
| Server | Express 5, Socket.IO 4, Mongoose 9, zod 4, sharp, nodemailer |
| Web | Vite 8, React 19, React Router 8, TanStack Query 5, CSS modules, lucide icons |
| Database | MongoDB (kept from the original) |
| Sign-in | Email one-time code. SMTP when `SMTP_URL` is set, otherwise the code is printed to the server log |
| Sessions | Opaque random token in an httpOnly cookie, stored hashed; no JWT |
| Audio | WebRTC full mesh, Socket.IO for signaling and presence |
| Tests | Vitest (server integration on mongodb-memory-server, web units on jsdom), Playwright e2e with fake microphones |
| Shipping | One Docker image (server serves the built SPA), `compose.yaml` with MongoDB, image on GHCR per release |
| Branch | `prod` renamed to `main` |

## Features

From the original requirements, all of which ship:

- **Sign in** with an email code. New addresses get an account; returning addresses log in. Logout from the navigation.
- **Onboarding**: full name, unique username, optional avatar, optional short bio. Editable later.
- **Rooms list**: every open room, social rooms of people you follow, and your own rooms, with live listener counts and search by topic.
- **Room types**: open (listed for everyone), social (listed for the owner's followers), private (never listed, joined by link).
- **Roles**: speakers can unmute; listeners join muted and can raise a hand. The owner invites listeners to speak, moves speakers back to the audience, and ends the room.
- **Microphone choice** from the available input devices, switchable mid-room.
- **Speaking indicator** on whoever is talking.
- **Profiles** at `/u/:username` with follower and following counts and a follow button.

## Architecture

```
browser (web)  --HTTP /api-->  server (Express) --> MongoDB
     |  \--Socket.IO /socket.io-->  signaling + presence (in memory)
     \<====== WebRTC audio, peer to peer =====>  other browsers
```

### Server modules

- `config.ts`: environment parsed and validated with zod; one typed `Config` object.
- `app.ts`: `createApp(config)` builds Express, the HTTP server and Socket.IO. Used by `index.ts` and by tests.
- `auth/`: login codes (6 digits, HMAC-hashed, 10 minute expiry, 5 attempts, 30 second resend cooldown), sessions (32 random bytes, SHA-256 stored, 30 day sliding expiry), mailer transports (`smtp`, `log`, `file`), `requireUser` middleware.
- `routes/`: `auth`, `me`, `users`, `rooms`, `config`, `health`. Input validated with zod; errors go through one handler that returns `{ error: { code, message } }`.
- `realtime/`: Socket.IO handshake reads the session cookie; `presence.ts` holds who is in which room with which role, mute and hand state; `signaling.ts` handles events. Rooms left empty end after `ROOM_EMPTY_TTL` (default 5 minutes); on startup every live room gets that timer.
- `avatars.ts`: raw image upload, resized to 256x256 WebP with sharp, stored under `DATA_DIR/avatars`, served at `/uploads/avatars`.

### Data model

- `User { email (unique), username (unique, lowercase), name, bio, avatar, createdAt }`. A user is onboarded when name and username are set.
- `LoginCode { email, codeHash, expiresAt (TTL index), attempts, sentAt }`
- `Session { tokenHash (unique), user, expiresAt (TTL index), userAgent }`
- `Follow { follower, followee }`, unique pair.
- `Room { publicId (unique, 10 random base62 chars), topic, type, owner, speakers[], endedAt }`. The `publicId` is the URL id so private links cannot be guessed.

### HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/code` | Send a code to `{ email }` |
| POST | `/api/auth/verify` | `{ email, code }`, sets the session cookie, returns the user |
| POST | `/api/auth/logout` | Ends the session |
| GET | `/api/me` | Current user or 401 |
| PATCH | `/api/me` | Update name, username, bio |
| PUT | `/api/me/avatar` | Raw image body |
| GET | `/api/users/:username` | Profile with counts and `isFollowing` |
| PUT/DELETE | `/api/users/:username/follow` | Follow or unfollow |
| GET | `/api/rooms?q=` | Rooms visible to the caller, with live counts |
| POST | `/api/rooms` | `{ topic, type }` |
| GET | `/api/rooms/:id` | One room, subject to visibility rules |
| DELETE | `/api/rooms/:id` | Owner ends the room |
| GET | `/api/config` | ICE servers and limits for the client |
| GET | `/api/health` | Liveness and database state |

Mutating requests must carry `Content-Type: application/json` (or an image type for the avatar) and, when present, an `Origin` matching `APP_URL`. Cookies are `SameSite=Lax`, `Secure` when `APP_URL` is https.

### Realtime contract (in `shared`)

Client to server: `room:join` (ack with the participant list and own role), `room:leave`, `rtc:signal { to, description | candidate }`, `mic:set { muted }`, `hand:set { raised }`, `role:set { peerId, role }` (owner only).

Server to client: `peer:joined`, `peer:left`, `peer:updated`, `rtc:signal { from, ... }`, `room:ended`, `room:kicked` (same user joined from another tab).

The newcomer creates the offers to everyone already present, so two sides never offer at once. Each connection gets one `sendrecv` audio transceiver from the start; listeners send nothing until promoted, then `replaceTrack` adds the microphone without renegotiation. Switching microphones uses `replaceTrack` too. Mute disables the track and broadcasts the state. Roles are enforced by the server for state and by the client for media, which is the limit of a peer-to-peer mesh; the docs say so.

Rooms cap at `ROOM_MAX_PARTICIPANTS` (default 25) because every pair holds a connection.

### Web

Routes: `/` landing, `/signin`, `/welcome` (onboarding), `/rooms`, `/r/:id`, `/u/:username`, `/settings`, 404. Guards redirect signed-out users to `/signin` and signed-in users without a username to `/welcome`. API calls go through one `fetch` wrapper; server state lives in TanStack Query; the room page uses a `useRoom` hook that owns the socket, the peer connections and the participant state (a reducer, unit tested). Remote speaking levels come from `RTCRtpReceiver.getSynchronizationSources()`, local level from an `AnalyserNode`. Participant tiles expose `data-connection` and `data-speaking` so e2e tests can assert real audio.

## Error handling

- Server: zod failures become 400 with field messages; known conditions throw `HttpError(status, code, message)`; anything else is logged and returned as 500 without internals.
- Socket acks return `{ ok: false, error }` rather than throwing; the room page shows the reason (room ended, full, not allowed).
- Media: denied microphone permission keeps the user in the room as a listener with a visible notice instead of failing the join.

## Testing

- `server/test`: HTTP integration with supertest against `createApp` and mongodb-memory-server; Socket.IO tests with real clients for join, roles, relay and room end.
- `web/src/**/*.test.ts(x)`: the room reducer, the API wrapper and the sign-in form.
- `e2e/`: Playwright on Chromium with fake media. Sign in through the file mail outbox, onboarding, room creation and search, two users in one room hearing each other (`data-speaking` on the remote tile), mute propagation, raise hand and promotion, private link, follow, room end.
- CI runs lint, typecheck, unit and integration tests on Node 22 and 24, the e2e suite, a Docker build with a health check, CodeQL, and Pages.

## Repository

README (concise, house style), CONTRIBUTING, SECURITY, CODE_OF_CONDUCT (Contributor Covenant 2.1), CHANGELOG (Keep a Changelog), `docs/ARCHITECTURE.md`, `docs/self-hosting.md` (compose, reverse proxy with TLS, TURN), issue forms, PR template, CODEOWNERS, dependabot, workflows (ci, codeql, pages, release), `site/` project page, `.editorconfig`, `.nvmrc`, Prettier, ESLint.

GitHub: description, topics, homepage on Pages, issues and discussions on, `v1.0.0` release with a GHCR image, a few `good first issue` issues seeded from the out-of-scope list.

## Out of scope for 1.0

Horizontal scaling (needs a shared Socket.IO adapter and shared presence), an SFU for large rooms, phone/SMS sign-in, chat, recordings, moderation beyond the owner's controls. These become seeded issues where they suit newcomers.

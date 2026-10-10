# Contributing

Thanks for helping with DevsBooth. This page covers the setup, how the code is organised, how to test a change, and what to check before opening a pull request.

## Setup

You need Node 22 or newer (`.nvmrc` pins 22) and git. MongoDB and Chromium are downloaded for you the first time they are needed.

```sh
git clone https://github.com/danieltyukov/devsbooth.git
cd devsbooth
npm install
npm run dev
```

`npm run dev` starts three processes: a local MongoDB on port 27018 with its data in `.data/mongo`, the server on port 3000 (restarted on change), and the Vite dev server on http://localhost:5173 (hot reload). Set `MONGODB_URI` to use your own database instead.

Sign in with any email address. Without SMTP the code is printed in the terminal, on a line starting `Sign-in code for`. To test a room with two people, use a second browser or a private window; each needs a microphone, or use Chrome with `--use-fake-device-for-media-stream`.

## Layout

```
shared/   Types and limits used by both sides: API shapes, Socket.IO events, input rules
server/   Express API, Socket.IO signaling and presence, MongoDB models
  src/auth/      sign-in codes, sessions, mail transports, middleware
  src/routes/    HTTP endpoints, one file per resource
  src/realtime/  presence (who is where), room lifecycle, the Socket.IO hub
  src/rooms/     room queries and visibility rules
  test/          integration tests against a real (in-memory) MongoDB
web/      React client
  src/rtc/       the WebRTC mesh, the room reducer, audio levels, the session hook
  src/pages/     one component per route
  src/components/
e2e/      Playwright tests that drive the built app in Chromium
docs/     architecture and self-hosting guides
site/     the project website, published to GitHub Pages as it is
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the design: sign-in, sessions, the realtime contract, the WebRTC negotiation, and the limits of a full mesh.

## Tests

```sh
npm run check      # typecheck, lint, unit and integration tests, build
npm test           # just the Vitest suites (server and web)
npm run test:e2e   # build, then Playwright
```

- **Server tests** (`server/test`) start the real app with `createApp` on a random port and an in-memory MongoDB, then use supertest and Socket.IO clients. Add one for every endpoint or socket event you touch.
- **Web tests** (`web/src/**/*.test.ts(x)`) run in jsdom: reducers, the API client, forms.
- **End-to-end tests** (`e2e/tests`) run the production build with sign-in codes written to `e2e/.cache/outbox`, and Chromium with fake microphones that play a tone. Participant tiles expose `data-role`, `data-muted`, `data-hand`, `data-connection` and `data-speaking`; `data-speaking` comes from the level of the received WebRTC audio, so a test that waits for it proves audio crossed between browsers. `npx playwright test --ui` (inside `e2e/`) is the easiest way to debug one.

The first run downloads a MongoDB binary (about 120 MB) for the test database, and `npx playwright install chromium` fetches the browser if you do not have it.

## Ground rules

- The server is the authority on room state. Clients may hide controls, but every permission check (who may speak, who may end a room, who may see a social room) also happens on the server, with a test.
- Audio is peer to peer, so the server cannot enforce who sends sound. Receivers therefore only play peers the server lists as unmuted speakers; keep it that way.
- Validate every input on the server with zod, including Socket.IO payloads.
- Errors returned to users say what happened and what to do next, without internals.
- New environment variables go in `server/src/config.ts`, `.env.example` and the README table.
- Keep dependencies few. Ask in an issue before adding a large one.

## Style

Prettier formats everything (`npm run format`), ESLint checks it (`npm run lint`). TypeScript is strict. Prefer small modules with one job, plain functions over classes unless there is state to hold, and comments that explain why rather than what.

In the interface, write short sentence-case text that says what a control does: "Start a room", not "Submit". No emojis in code, comments, docs, commit messages or the UI.

## Commits and pull requests

Commits follow the conventional commit format (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:`), with a subject under 72 characters that describes the change.

Before opening a pull request:

- `npm run check` passes, and `npm run test:e2e` passes if you touched the web client, signaling or WebRTC.
- New behaviour has a test.
- README, docs or `.env.example` are updated if behaviour or configuration changed.
- `CHANGELOG.md` has an entry under Unreleased for anything users will notice.

Small, focused pull requests get reviewed fastest. For anything larger, open an issue first so we can agree on the approach.

## Releases

Maintainers release by bumping the version in the root `package.json`, moving the Unreleased changelog entries under the new version, and pushing a `vX.Y.Z` tag. The release workflow runs the checks, publishes the Docker image to `ghcr.io/danieltyukov/devsbooth` for amd64 and arm64, and creates the GitHub release.

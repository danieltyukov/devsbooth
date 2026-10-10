<p align="center">
  <img src="docs/img/logo.svg" alt="DevsBooth" width="258">
</p>

<p align="center">Self-hosted audio rooms for developers.<br>Open a room, talk through what you are building, and let people drop in.</p>

<p align="center">
  <a href="https://github.com/danieltyukov/devsbooth/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/danieltyukov/devsbooth/ci.yml?branch=main&label=CI" alt="CI status"></a>
  <a href="https://github.com/danieltyukov/devsbooth/releases"><img src="https://img.shields.io/github/v/release/danieltyukov/devsbooth" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node 22 or newer">
</p>

<p align="center">
  <a href="https://danieltyukov.github.io/devsbooth/">Website</a> ·
  <a href="#self-host">Self-host</a> ·
  <a href="#develop">Develop</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/room-dark.webp">
  <img src="docs/img/room-light.webp" alt="A DevsBooth room: the topic as a large heading, three speakers shown as channel strips with level meters, one of them lit while talking, an audience of three with one raised hand, and a control bar with Leave quietly, an On air button, a microphone picker, Copy link and End room.">
</picture>

## What it does

- **Sign in with an email code.** No passwords. Without SMTP configured, codes are printed in the server log, so a fresh install works with no accounts anywhere.
- **Three kinds of room.** Open rooms are listed for everyone, follower rooms for people who follow the host, and private rooms only for whoever has the link.
- **Speakers and listeners.** Listeners join muted and raise a hand. The host invites them to speak, moves people back to the audience, and ends the room.
- **Live meters.** Each speaker's strip shows their audio level, and your own mic button lights up when you are on air. Pick any microphone the browser can see.
- **Profiles and follows,** with a photo, a short bio and follower counts.
- **Peer to peer audio.** Voices travel between browsers over WebRTC. The server introduces people and keeps track of who is in which room; it never handles audio.

## Self-host

You need Docker with Compose. Browsers only allow microphones on `https` (or `localhost`), so put DevsBooth behind a reverse proxy with TLS for real use.

```sh
git clone https://github.com/danieltyukov/devsbooth.git
cd devsbooth
cp .env.example .env   # set APP_URL and SMTP_URL
docker compose up -d
```

DevsBooth is now on port 3000, with MongoDB beside it. The image is published as `ghcr.io/danieltyukov/devsbooth`. [docs/self-hosting.md](docs/self-hosting.md) covers the reverse proxy, email, TURN for strict networks, backups and upgrades.

## Configure

Everything is optional except where noted. The full list with examples is in [.env.example](.env.example).

| Variable                | Purpose                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `APP_URL`               | The address people open, such as `https://booth.example.org`. Required outside localhost.                          |
| `MONGODB_URI`           | MongoDB connection string. Set by `compose.yaml`; required when running the server yourself.                       |
| `SMTP_URL`              | SMTP server for sign-in emails, such as `smtps://user:pass@smtp.example.org:465`. Without it, codes go to the log. |
| `MAIL_FROM`             | Sender address for sign-in emails.                                                                                 |
| `ICE_SERVERS`           | STUN and TURN servers as JSON. Defaults to a public STUN server.                                                   |
| `TRUST_PROXY`           | Set to `1` behind a reverse proxy, so client addresses and https are detected.                                     |
| `ROOM_MAX_PARTICIPANTS` | People per room, default 25. Every pair holds a connection, so keep it modest.                                     |
| `ROOM_EMPTY_TTL`        | Seconds an empty room stays open before it ends, default 300. `0` keeps rooms until the host ends them.            |

## Develop

Requires Node 22 or newer. No MongoDB install and no accounts needed.

```sh
npm install
npm run dev     # web on http://localhost:5173, API on :3000, a local MongoDB in .data/
```

Sign in with any address; the code appears in the terminal. Open a second browser profile to be two people in the same room.

```sh
npm run check      # typecheck, lint, unit and integration tests, build
npm run test:e2e   # builds, then runs Playwright with two browsers and fake microphones
```

The repository is an npm workspace: `server/` (Express, Socket.IO, MongoDB), `web/` (React and Vite), `shared/` (the API and realtime types both sides use), and `e2e/` (Playwright). [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how a room works, from sign-in to audio.

## Contributing

Contributions are welcome, from fixing a typo to building a feature. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and look for issues labelled [good first issue](https://github.com/danieltyukov/devsbooth/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22). Questions and ideas go in [Discussions](https://github.com/danieltyukov/devsbooth/discussions). Please report security problems privately, as described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-10

### Added

- Room keyboard shortcuts: speakers can press M to mute or unmute, and listeners can press H to raise or lower a hand ([#16](https://github.com/danieltyukov/devsbooth/issues/16), thanks @pollychen-lab).
- Profiles list the live rooms a person hosts, following the same visibility rules as the rooms list ([#15](https://github.com/danieltyukov/devsbooth/issues/15)).
- On phones and other browsers with a share sheet, "Share link" opens it; elsewhere the link is copied ([#17](https://github.com/danieltyukov/devsbooth/issues/17)).
- The host can change the room topic, and everyone in the room sees it at once ([#18](https://github.com/danieltyukov/devsbooth/issues/18)).
- Audio can go through a LiveKit SFU instead of the browser mesh, for rooms of hundreds. Speakers publish once, LiveKit enforces who may publish, and the default room cap becomes 200 ([#20](https://github.com/danieltyukov/devsbooth/issues/20)).
- Several server processes can run side by side: with `REDIS_URL`, presence lives in Redis and the Socket.IO Redis adapter carries events between processes. Processes that stop are swept out of their rooms ([#19](https://github.com/danieltyukov/devsbooth/issues/19)).

### Security

- The 2022 prototype had committed env files with database and Twilio credentials. Those credentials are revoked, and the files are now removed from the git history, which was rewritten on 2026-10-10. Clones and forks made before then still contain them; clone again rather than pulling.

## [1.0.0] - 2026-10-10

DevsBooth is back as a community project. This release is a rewrite in TypeScript; the 2022 prototype it replaces never ran end to end and shares no code with it.

### Added

- Sign-in with an 8-digit code sent by email, bound to the browser that asked for it. Without SMTP the code is printed in the server log, so a fresh install needs no accounts.
- Onboarding with name, unique username, optional photo (resized to 256 px WebP) and bio, editable later.
- Profiles with follow, follower and following counts.
- Rooms list with live participant counts and topic search.
- Open, follower and private rooms. Follower rooms are listed for, and open to, people who follow the host; private rooms are unlisted and joined by link.
- Speakers and listeners, raised hands, and host controls to invite speakers, move them back to the audience, and end the room.
- WebRTC audio in a full mesh, with microphone choice, live level meters, speaking indicators, mute, and recovery when the browser blocks autoplay. Listeners send nothing; promotion attaches the microphone without renegotiation.
- Receivers only play peers the server lists as unmuted speakers.
- Rooms end on their own after staying empty for `ROOM_EMPTY_TTL` seconds (default 300).
- One person per room: opening a room in a second tab moves you there.
- `ICE_SERVERS` for STUN and TURN, and `ICE_TRANSPORT_POLICY=relay` to route all audio through TURN.
- Light and dark themes.
- Docker image on `ghcr.io/danieltyukov/devsbooth` for amd64 and arm64, and a `compose.yaml` with MongoDB 8.2.
- `npm run dev` with a local MongoDB started automatically.
- Server integration tests, web unit tests, and Playwright end-to-end tests in which two browsers with fake microphones hear each other.
- Contributor guide, security policy, code of conduct, architecture and self-hosting docs, and a project website.

[Unreleased]: https://github.com/danieltyukov/devsbooth/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/danieltyukov/devsbooth/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/danieltyukov/devsbooth/releases/tag/v1.0.0

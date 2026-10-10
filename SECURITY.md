# Security policy

DevsBooth handles sign-in codes, session cookies and live microphones. Problems in those areas matter most.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub security advisories: https://github.com/danieltyukov/devsbooth/security/advisories/new. Include the version or commit, how you run it (Docker image or from source), the steps to reproduce, and what an attacker could gain.

You should get an acknowledgement within seven days. Confirmed problems are fixed in a patch release and described in `CHANGELOG.md` and the advisory. Only the latest release receives fixes.

## Scope

In scope:

- Signing in as someone else, or keeping access after logging out.
- Joining a room you should not be able to (a follower room without following the host), or acting as its host.
- Making other people's browsers play your audio when the server says you are a listener or muted.
- Reading another user's email address, or anything about private rooms you were not given the link to.
- Cross-site request forgery, cross-site WebSocket hijacking, XSS, and open redirects.
- Denial of service that a single client can cause cheaply.
- The Docker image and the release pipeline.

Out of scope:

- Anything that requires control of the server, its database or the user's device.
- Problems in MongoDB, browsers, or the STUN and TURN servers you configure; report those upstream.
- Missing hardening that depends on deployment, such as TLS settings of your reverse proxy.

## How sign-in is protected

Sign-in uses an 8-digit code sent by email. The design, so reports can focus on real gaps:

- Each code is bound to the browser that asked for it. `POST /api/auth/code` returns a random challenge, and the code only works together with that challenge. Several codes for one address can be live at once, so nobody can cancel or guess against a code they did not request.
- A code allows three guesses, reserved atomically before comparison, and expires after ten minutes.
- One requester (IP address, stored as an HMAC under a key held only in memory) can have at most five codes sent to an address per hour, and an address receives at most twenty per hour from everyone. That bounds guessing to 60 tries per hour per address against 10^8 codes.
- Sign-in endpoints are also rate limited per IP (`AUTH_RATE_LIMIT`).
- Codes are stored as salted HMACs; session tokens are 32 random bytes, stored as SHA-256 hashes, in `HttpOnly`, `SameSite=Lax` cookies that are `Secure` when `APP_URL` is https.

Known trade-offs: an attacker spread across many IP addresses can use up an address's hourly quota and delay its owner's sign-in by up to an hour; a server restart resets the per-requester counts (the per-address cap survives); and behind a reverse proxy `TRUST_PROXY` must be set or every request appears to come from the proxy.

## Audio and roles

Audio flows directly between browsers, so the server cannot stop a modified client from sending sound. Instead, every client plays a peer only while the server's room state lists that peer as an unmuted speaker, and only the host can change roles. People in a room see each other's IP addresses through WebRTC, as with any peer-to-peer call; a TURN server with relay-only policy can hide them, at the cost of bandwidth.

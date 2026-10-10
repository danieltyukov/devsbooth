# Self-hosting

DevsBooth runs as one container next to MongoDB. People's browsers send audio directly to each other, so the server needs little bandwidth; what it needs is a public `https` address, a way to send email, and, for some networks, a TURN server.

## Quick start

```sh
git clone https://github.com/danieltyukov/devsbooth.git
cd devsbooth
cp .env.example .env
```

Edit `.env`:

```sh
APP_URL=https://booth.example.org
SMTP_URL=smtps://user:password@smtp.example.org:465
MAIL_FROM=DevsBooth <no-reply@example.org>
TRUST_PROXY=1
```

Then start it:

```sh
docker compose up -d
docker compose logs -f app
```

The app listens on port 3000 (change it with `PORT` in `.env`). Avatars are kept in the `app-data` volume and the database in `mongo-data`.

`compose.yaml` uses the published image, `ghcr.io/danieltyukov/devsbooth:latest`. To build from your checkout instead, run `docker compose up -d --build`. Pin a version such as `ghcr.io/danieltyukov/devsbooth:1.0.0` if you prefer upgrading deliberately.

## HTTPS

Browsers only let pages use the microphone on `https` or `localhost`, so a public instance needs TLS. Put a reverse proxy in front of port 3000 and set `TRUST_PROXY=1`. The proxy must pass WebSocket upgrades for `/socket.io`.

Caddy obtains certificates by itself:

```caddy
booth.example.org {
	reverse_proxy localhost:3000
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name booth.example.org;
    # ssl_certificate and ssl_certificate_key here

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
    }
}
```

`APP_URL` must be exactly the address people open, scheme included. Requests from any other origin are refused with "Cross-origin requests are not allowed".

## Email

Sign-in codes go out over SMTP when `SMTP_URL` is set. Any provider works: your own mail server, or a transactional service that gives you SMTP credentials. Use `smtps://` with port 465, or `smtp://` with port 587 for STARTTLS. Without `SMTP_URL`, codes are written to the log (`docker compose logs app`), which is handy for a private test but not for other people.

## TURN

Browsers find each other with STUN, which works for most home and office networks. Some networks (strict corporate firewalls, some mobile carriers) block direct connections, and then people in a room cannot hear each other. A TURN server relays audio for them.

[coturn](https://github.com/coturn/coturn) is the usual choice. A minimal setup with long-term credentials:

```sh
docker run -d --network host --name coturn coturn/coturn \
  -n --log-file=stdout \
  --realm=booth.example.org \
  --user=devsbooth:a-long-random-password \
  --lt-cred-mech \
  --listening-port=3478 \
  --min-port=49160 --max-port=49200 \
  --external-ip=YOUR_PUBLIC_IP
```

Open UDP and TCP 3478 and UDP 49160 to 49200 in your firewall, then tell DevsBooth about it:

```sh
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:booth.example.org:3478?transport=udp","turn:booth.example.org:3478?transport=tcp"],"username":"devsbooth","credential":"a-long-random-password"}]
```

Every signed-in user can read these credentials (browsers need them), so give the TURN server its own password and keep its port range small.

With a TURN server in place, `ICE_TRANSPORT_POLICY=relay` routes all audio through it. People in a room then no longer see each other's IP addresses, at the cost of server bandwidth.

## Limits

A room holds `ROOM_MAX_PARTICIPANTS` people (default 25). Every pair holds a connection, so very large rooms strain browsers before they strain the server.

## Several processes

One process goes a long way, since it never touches audio. To run more, for redundancy or to spread WebSocket connections, give every process the same Redis:

```sh
REDIS_URL=redis://redis:6379
```

With `REDIS_URL` set, presence (who is in which room, with which role) lives in Redis, and the processes reach each other's sockets through the Socket.IO Redis adapter. Each process sends a heartbeat; when one stops, the others take its participants out of their rooms and tell everyone, within about twenty seconds. Put the processes behind any load balancer that passes WebSocket upgrades. Sticky sessions are not needed, because clients only use WebSockets.

A compose sketch:

```yaml
services:
  app:
    image: ghcr.io/danieltyukov/devsbooth:latest
    environment:
      MONGODB_URI: mongodb://mongo:27017/devsbooth
      REDIS_URL: redis://redis:6379
    volumes:
      - app-data:/data
    deploy:
      replicas: 3
  redis:
    image: redis:8
```

- Avatars are files, so every process needs the same `DATA_DIR`: a shared volume, as above, or uploads only exist on the process that received them.
- Use one Redis instance, not Redis Cluster. Presence updates are scripts that touch several keys at once.
- `REDIS_PREFIX` (default `devsbooth:`) keeps two DevsBooth instances apart if they share a Redis.

## Backups and upgrades

Back up the database and the avatars:

```sh
docker compose exec mongo mongodump --archive --gzip --db devsbooth > devsbooth-$(date +%F).archive.gz
docker run --rm -v devsbooth_app-data:/data -v "$PWD":/backup busybox tar czf /backup/avatars-$(date +%F).tgz -C /data avatars
```

Restore with `mongorestore --archive --gzip` and by extracting the tarball into the volume. The volume name is prefixed with your compose project name, `devsbooth` by default.

Upgrade:

```sh
docker compose pull
docker compose up -d
```

Read the [changelog](../CHANGELOG.md) first; breaking changes are called out there.

## Without Docker

You need Node 22 or newer and MongoDB 8.

```sh
npm ci
npm run build
MONGODB_URI=mongodb://localhost:27017/devsbooth APP_URL=https://booth.example.org npm start
```

The server serves the built client from `web/dist` and stores avatars in `server/data` (set `DATA_DIR` to put them elsewhere). A `.env` file in the repository root is read on start. Run it under systemd or another supervisor.

## Troubleshooting

- **The microphone button stays disabled, or the browser never asks.** The page is not on `https`, or the browser has blocked the site's microphone. Check the address bar's site settings.
- **People join but cannot hear each other.** The participant shows "No audio link". Add a TURN server.
- **Sign-in codes never arrive.** Check `docker compose logs app` for SMTP errors, and your provider's sending limits.
- **"Cross-origin requests are not allowed".** `APP_URL` does not match the address in the browser.
- **"Too many requests" for everyone at once.** Behind a reverse proxy without `TRUST_PROXY=1`, every visitor appears to come from the proxy's address and shares one rate limit (`API_RATE_LIMIT`, 600 requests per minute per address by default).
- **MongoDB keeps restarting with "Linux kernel versions 6.19 and newer has a known incompatibility".** The 8.0 line of MongoDB (the plain `mongo:8` tag) refuses to start on recent kernels. `compose.yaml` uses `mongo:8.2`, which does not have that problem.

# Discord Bot - 24/7 Ready

A minimal Discord bot with slash commands (`/ping`, `/echo`), ready for local run, Docker, or systemd. Optional health endpoint for platforms that require HTTP pings.

## 1) Create a bot on Discord Dev Portal
- Go to the Discord Developer Portal.
- Create an Application → Bot → Reset Token → copy the token.
- Enable Privileged Intents: Message Content Intent.
- OAuth2 → URL Generator: scopes `bot` and `applications.commands`, permissions as needed (e.g., Send Messages). Invite the bot to your server.

## 2) Local run
```bash
cp .env.example .env
# paste your token in DISCORD_TOKEN=
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python bot/main.py
```

## 3) Docker (recommended for 24/7)
```bash
cp .env.example .env
# fill DISCORD_TOKEN
docker compose up -d --build
```
- The service auto-restarts on failure via `restart: always`.

## 4) systemd service (on a VPS)
Create a virtualenv at a fixed path, then create a unit file like below. Adjust paths accordingly.

`/etc/systemd/system/discord-bot.service`:
```ini
[Unit]
Description=Discord Bot
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/opt/discord-bot
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=/opt/discord-bot/.env
ExecStart=/bin/bash -lc '. /opt/discord-bot/.venv/bin/activate && python bot/main.py'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now discord-bot
sudo systemctl status discord-bot
```

## 5) Hosted options
- Render: run as a Background Worker; optional health port not needed.
- Railway/Fly.io/Dokku: deploy Docker; set env var `DISCORD_TOKEN`; optional `ENABLE_HEALTH_SERVER=true` and open `PORT` if required.

## Notes
- Faster command updates: set `GUILD_ID` in `.env` for per-guild sync while developing.
- Health endpoint: GET `/healthz` on `PORT` if `ENABLE_HEALTH_SERVER=true`.
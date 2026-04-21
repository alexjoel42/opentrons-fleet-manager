# ABR Raspberry Pi — always-on API + static UI

Run the Fleet Manager on a Raspberry Pi so the lab can open one URL on the LAN (for example **`http://abrfriend.local`**) without SSH or manual `make dev` / `make run-backend`.

## Notes

Parts 1 and 2 should be done and are mostly there for posterity and if we need a new raspberry pi.

This guide uses:

- **systemd** — start the FastAPI (Uvicorn) service on boot.
- **nginx** — serve the built frontend (`npm run build` → `dist/`) on **port 80** and reverse-proxy **`/api`** to the API on **127.0.0.1:8000** (not exposed directly).

Adjust paths below if your clone lives somewhere other than `~/opentrons-fleet-manager/...`.

---

## Ports (summary)

| Port | Service | Who connects |
|------|---------|----------------|
| **80** | nginx (HTTP) | Browsers on the LAN → `http://<pi-hostname>.local` or `http://<pi-ip>` |
| **8000** | FastAPI (Uvicorn) | **Only localhost** — nginx proxies `/api` here; do not expose 8000 to the LAN unless you intend to. |
| **5174** | Vite dev (`make dev`) | Dev only — not used for this production-style setup. |

---

## 1. Prerequisites

On Raspberry Pi OS (Debian-based):

```bash
sudo apt update
sudo apt install -y python3-venv nginx git
```

Install **Node.js** and **npm** if missing (required for `npm ci` / `npm run build`):

```bash
sudo apt install -y nodejs npm
node -v
npm -v
```

---

## 2. One-time app setup

Clone or copy the repo, then from the **`Observability_V0`** directory (the one that contains `package.json`, `Makefile`, and `backend/`):

```bash
cd ~/opentrons-fleet-manager/Alex_Observability/Observability_V0
make setup
```

This creates **`.venv`** and installs backend dependencies (including **uvicorn**).

---

## 3. Build the frontend for same-origin `/api`

The UI should call the API **on the same host** as the page (no cross-origin). Build with an **empty** `VITE_API_URL` so requests go to `/api/...` on whatever host serves the app (nginx on port 80).

```bash
cd ~/opentrons-fleet-manager/Alex_Observability/Observability_V0
VITE_API_URL= npm run build
```

The result should look like

```bash
> observability_v0@0.0.0 build
> tsc -b && vite build

vite v7.3.1 building client environment for production...
✓ 121 modules transformed.
dist/index.html                   0.81 kB │ gzip:   0.43 kB
dist/assets/index-BzenA1ei.css   50.96 kB │ gzip:   8.98 kB
dist/assets/index-Car7Ofat.js   376.15 kB │ gzip: 109.12 kB
✓ built in 8.73s
```

Confirm **`dist/`** exists and contains **`index.html`**.

### If you need to Rebuild and reload nginx after frontend changes:

Again please only run this once you pull in changes 

```bash
VITE_API_URL= npm run build
sudo systemctl reload nginx
```

---


## 4. systemd: API on boot

Assume the project on the Pi is checked out at **`/home/admin/opentrons-fleet-manager/Alex_Observability/Observability_V0`** (replace `admin` with your login if different). All paths below are under that directory.

Run the API as a normal user. The API listens only on **127.0.0.1** so only nginx on the same machine should talk to it.

Create the unit file at **`/etc/systemd/system/fleet-manager-api.service`**.

In **`ls /etc`** you should see a directory named **`systemd`**, not `system`. From `/etc`, use **`cd systemd/system`** (two levels: *systemd*, then *system*), or jump in one step: **`cd /etc/systemd/system`**. If you run **`cd system`** you will get “No such file or directory” — that is expected; the first directory name is **`systemd`**.

To create the unit file without changing directories:

```bash
sudo vi /etc/systemd/system/fleet-manager-api.service
```

(`sudo mkdir -p /etc/systemd/system` first only if that path is missing, which is unusual on Raspberry Pi OS.)

```ini
[Unit]
Description=Fleet Manager FastAPI (Uvicorn)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=admin
Group=admin
WorkingDirectory=/home/admin/opentrons-fleet-manager/Alex_Observability/Observability_V0/backend
Environment=PYTHONUNBUFFERED=1
# Optional: seed robot IPs when robot_ips.json is missing (comma-separated).
# Environment=ROBOT_IPS=192.168.1.10,192.168.1.11
ExecStart=/home/admin/opentrons-fleet-manager/Alex_Observability/Observability_V0/.venv/bin/uvicorn demo_api:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fleet-manager-api.service
sudo systemctl status fleet-manager-api.service
```

```bash

admin@abrfriend:/etc/systemd/system $ sudo systemctl status fleet-manager-api.service
fleet-manager-api.service - Fleet Manager FastAPI (Uvicorn)
     Loaded: loaded (/etc/systemd/system/fleet-manager-api.service; enabled; preset: enabled)
     Active: active (running) since Tue 2026-04-14 13:23:14 EDT; 7s ago
 Invocation: b06b996313bf4818aaae35cbad4bfe67
   Main PID: 7322 (uvicorn)
      Tasks: 6 (limit: 8742)
        CPU: 2.111s
     CGroup: /system.slice/fleet-manager-api.service
             └─7322 /home/admin/opentrons-fleet-manager/Alex_Observability/Observability_V0/.venv/bin/python3 /ho>

Apr 14 13:23:14 abrfriend systemd[1]: Started fleet-manager-api.service - Fleet Manager FastAPI (Uvicorn).
Apr 14 13:23:16 abrfriend uvicorn[7322]: INFO:     Started server process [7322]
Apr 14 13:23:16 abrfriend uvicorn[7322]: INFO:     Waiting for application startup.
Apr 14 13:23:16 abrfriend uvicorn[7322]: INFO:     Application startup complete.
Apr 14 13:23:16 abrfriend uvicorn[7322]: INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
lines 1-15/15 
```

Logs:

```bash
journalctl -u fleet-manager-api.service -f
```

**Note:** This uses production-style Uvicorn (**no** `--reload`). For development, keep using `make run-backend` in a terminal instead.

---

## 5. nginx: static `dist/` + `/api` proxy

Point **`root`** at your **`dist/`** directory. Proxy **`/api`** to the API.

Create **`/etc/nginx/sites-available/fleet-manager`** (adjust `root` and `server_name`):

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name abrfriend.local _;

    root /home/admin/opentrons-fleet-manager/Alex_Observability/Observability_V0/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable the site and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/fleet-manager /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

---

## 6. Hostname and `.local` (mDNS)

So browsers can use a name like **`abrfriend.local`**:

```bash
sudo hostnamectl set-hostname abrfriend
```

Ensure **Avahi** is available (Raspberry Pi OS usually has it):

```bash
sudo apt install -y avahi-daemon
sudo systemctl enable --now avahi-daemon
```

Other devices on the same LAN can then open:

```text
http://abrfriend.local
```

If `.local` fails on some clients, use the Pi’s IP address: **`http://192.168.x.x`**.

## 8. Quick checks

- API directly (on the Pi): `curl -sS http://127.0.0.1:8000/hehttp://abrfriend.local/dashboardalth` (or `/api/health` depending on routes exposed).
- Through nginx: `curl -sS http://127.0.0.1/api/health` from the Pi.
- From a laptop: open **`http://abrfriend.local`** (or the Pi’s IP).

---

## 9. Updating the app after `git pull`

```bash
cd ~/opentrons-fleet-manager/Alex_Observability/Observability_V0
git pull
make setup          # refresh deps if requirements/package.json changed
VITE_API_URL= npm run build
sudo systemctl restart fleet-manager-api.service
sudo systemctl reload nginx
```

---

## Related docs

- Cloud / Vercel / Render: [DEPLOY.md](DEPLOY.md)
- Repo overview: [README.md](../README.md)

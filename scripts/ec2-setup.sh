#!/usr/bin/env bash
#
# Sets up a fresh EC2 instance to serve MasjidPoint. Run once, on the server, as a user with sudo:
#
#   sudo bash ec2-setup.sh
#
# What it does: installs Node and nginx, creates a service account, pulls the code, runs it under
# systemd so it survives a reboot, and puts nginx in front on port 80. The app itself only ever
# listens on 127.0.0.1, so nginx is not optional — it is the only way in.
#
# Works on Ubuntu 22.04/24.04 and Amazon Linux 2023.
#
# Nothing here configures PostgreSQL or SMTP, so the app runs in its development JSON mode. That is
# deliberate: PRODUCTION.md refuses to start NODE_ENV=production without both, and this script is
# for getting the platform visible at a fixed address, not for taking real money. The whole site
# stays behind a shared password until that work is done.

set -euo pipefail

APP_USER=masjidpoint
APP_DIR=/opt/masjidpoint
APP_PORT=4174
REPO=${REPO:-https://github.com/waleed1914/masjidpoint.git}

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo bash ec2-setup.sh" >&2
  exit 1
fi

# ---- Which distribution -----------------------------------------------------
. /etc/os-release
case "$ID" in
  ubuntu|debian) FAMILY=debian ;;
  amzn)          FAMILY=amazon ;;
  *) echo "Unsupported OS: $ID. This script handles Ubuntu and Amazon Linux 2023." >&2; exit 1 ;;
esac
echo "==> Detected $PRETTY_NAME"

# ---- Node, nginx, git -------------------------------------------------------
echo "==> Installing Node, nginx and git"
if [[ $FAMILY == debian ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg git nginx
  if ! command -v node >/dev/null || [[ $(node -p "process.versions.node.split('.')[0]") -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  fi
else
  dnf install -y -q git nginx
  dnf install -y -q nodejs22 || dnf install -y -q nodejs20 || dnf install -y -q nodejs
  # SELinux blocks nginx from connecting to a local port unless told otherwise, which shows up as
  # a 502 with "Permission denied" in the error log and is easy to misdiagnose.
  command -v setsebool >/dev/null && setsebool -P httpd_can_network_connect 1 || true
fi
echo "    node $(node --version), nginx $(nginx -v 2>&1 | sed 's/.*\///')"

# ---- Service account --------------------------------------------------------
if ! id "$APP_USER" &>/dev/null; then
  echo "==> Creating the $APP_USER service account"
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER" 2>/dev/null \
    || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /sbin/nologin "$APP_USER"
fi

# ---- Code -------------------------------------------------------------------
# Cloned over HTTPS with no credentials. If the repository is made private again this fails with
# "Authentication failed" — set REPO to the git@github.com: form and add a read-only deploy key.
if ! git ls-remote --exit-code "$REPO" >/dev/null 2>&1; then
  echo "Cannot read $REPO without credentials — is the repository private?" >&2
  echo "If so, either make it public or set REPO to the SSH URL and add a deploy key." >&2
  exit 1
fi

if [[ -d $APP_DIR/.git ]]; then
  echo "==> Updating the existing checkout"
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet origin
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard --quiet origin/main
else
  echo "==> Cloning the repository"
  mkdir -p "$APP_DIR"; chown "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone --quiet "$REPO" "$APP_DIR"
fi

echo "==> Installing dependencies"
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --omit=dev --no-audit --no-fund --loglevel=error
sudo -u "$APP_USER" mkdir -p "$APP_DIR/data/uploads" "$APP_DIR/data/email-outbox"

# ---- Environment ------------------------------------------------------------
# Kept out of the repository and readable only by the service account. The password persists across
# re-runs so an existing link keeps working when you redeploy.
ENV_FILE=/etc/masjidpoint.env
if [[ ! -f $ENV_FILE ]]; then
  PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-z0-9' | head -c 12)
  cat > "$ENV_FILE" <<EOF
PORT=$APP_PORT
PREVIEW_USER=client
PREVIEW_PASSWORD=$PASSWORD
EOF
  chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
fi

# ---- systemd ----------------------------------------------------------------
echo "==> Installing the systemd service"
cat > /etc/systemd/system/masjidpoint.service <<EOF
[Unit]
Description=MasjidPoint
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3

# The app needs to write only its own data directory.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --quiet masjidpoint
systemctl restart masjidpoint

# ---- nginx ------------------------------------------------------------------
echo "==> Configuring nginx"
NGINX_CONF=$([[ $FAMILY == debian ]] && echo /etc/nginx/sites-available/masjidpoint || echo /etc/nginx/conf.d/masjidpoint.conf)
cat > "$NGINX_CONF" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Payment proofs and masjid photographs are posted as data URLs, and the app itself accepts
    # up to 8 MB. nginx defaults to 1 MB and would reject those with a 413 before the app saw them.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF

if [[ $FAMILY == debian ]]; then
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/masjidpoint
  rm -f /etc/nginx/sites-enabled/default
else
  # Amazon Linux ships a default server block in nginx.conf that would win on port 80.
  sed -i 's/listen       80 default_server;/listen       8080;/; s/listen       \[::\]:80 default_server;/listen       [::]:8080;/' /etc/nginx/nginx.conf || true
fi

nginx -t
systemctl enable --quiet nginx
systemctl restart nginx

# ---- Report -----------------------------------------------------------------
sleep 2
IP=$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null || echo "your-elastic-ip")
echo
if systemctl is-active --quiet masjidpoint; then
  echo "================================================================"
  echo " MasjidPoint is running."
  echo
  echo "   http://$IP"
  echo "   username: $(grep PREVIEW_USER $ENV_FILE | cut -d= -f2)"
  echo "   password: $(grep PREVIEW_PASSWORD $ENV_FILE | cut -d= -f2)"
  echo
  echo " It restarts by itself on reboot and if it crashes."
  echo " Logs:    sudo journalctl -u masjidpoint -f"
  echo " Update:  sudo bash $APP_DIR/scripts/ec2-setup.sh"
  echo "================================================================"
else
  echo "The service did not start. What it said:" >&2
  journalctl -u masjidpoint -n 30 --no-pager >&2
  exit 1
fi

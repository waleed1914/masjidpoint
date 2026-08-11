#!/usr/bin/env bash
#
# Puts a Let's Encrypt certificate in front of MasjidPoint and sends every plain request to it.
#
# Run on the server, after ec2-setup.sh, once the domain's DNS points at this machine:
#
#   sudo bash /opt/masjidpoint/scripts/enable-https.sh masjidpoint.co.uk www.masjidpoint.co.uk
#
# The first name is the one the site answers on; any others are alternatives on the same
# certificate. Certbot proves ownership by answering a request on port 80, so the DNS has to
# resolve here before this can work — the script checks that first and stops if it does not,
# because Let's Encrypt rate-limits failed attempts.
#
# Renewal is automatic: certbot installs a timer that renews inside the last thirty days.

set -euo pipefail

APP_DIR=/opt/masjidpoint
APP_PORT=4174
ENV_FILE=/etc/masjidpoint.env

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo: sudo bash enable-https.sh yourdomain.com" >&2
  exit 1
fi
if [[ $# -lt 1 ]]; then
  echo "Usage: sudo bash enable-https.sh <domain> [more domains...]" >&2
  exit 1
fi

PRIMARY=$1
DOMAINS=("$@")
EMAIL=${CERT_EMAIL:-}

. /etc/os-release
case "$ID" in
  ubuntu|debian) FAMILY=debian ;;
  amzn)          FAMILY=amazon ;;
  *) echo "Unsupported OS: $ID." >&2; exit 1 ;;
esac

# ---- Does the name actually point here? -------------------------------------
echo "==> Checking DNS"
PUBLIC_IP=$(curl -fsS --max-time 5 https://checkip.amazonaws.com | tr -d '[:space:]')
for domain in "${DOMAINS[@]}"; do
  RESOLVED=$(getent hosts "$domain" | awk '{print $1}' | head -1 || true)
  if [[ -z $RESOLVED ]]; then
    echo "    $domain does not resolve yet." >&2
    echo "    Add an A record for it pointing at $PUBLIC_IP, wait for it to spread, then run this again." >&2
    exit 1
  fi
  if [[ $RESOLVED != "$PUBLIC_IP" ]]; then
    echo "    $domain resolves to $RESOLVED, but this machine is $PUBLIC_IP." >&2
    echo "    Point the A record here and wait for the old answer to expire before running this again." >&2
    exit 1
  fi
  echo "    $domain -> $RESOLVED"
done

# ---- certbot ----------------------------------------------------------------
echo "==> Installing certbot"
if [[ $FAMILY == debian ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq certbot python3-certbot-nginx
else
  dnf install -y -q certbot python3-certbot-nginx
fi

# ---- Name the site in nginx before certbot edits it -------------------------
# certbot --nginx finds the block to change by its server_name, and the setup script leaves that
# as the catch-all "_", which it will not match.
NGINX_CONF=$([[ $FAMILY == debian ]] && echo /etc/nginx/sites-available/masjidpoint || echo /etc/nginx/conf.d/masjidpoint.conf)
if [[ ! -f $NGINX_CONF ]]; then
  echo "No nginx site at $NGINX_CONF — run ec2-setup.sh first." >&2
  exit 1
fi
echo "==> Naming the site ${DOMAINS[*]}"
sed -i "s/^\( *\)server_name .*/\1server_name ${DOMAINS[*]};/" "$NGINX_CONF"
nginx -t
systemctl reload nginx

# ---- The certificate --------------------------------------------------------
echo "==> Requesting the certificate"
CERT_ARGS=(--nginx --non-interactive --agree-tos --redirect)
for domain in "${DOMAINS[@]}"; do CERT_ARGS+=(-d "$domain"); done
if [[ -n $EMAIL ]]; then CERT_ARGS+=(-m "$EMAIL"); else CERT_ARGS+=(--register-unsafely-without-email); fi
certbot "${CERT_ARGS[@]}"

# --redirect above rewrites the port 80 block to send everything to https, so a visitor typing
# the bare address still lands on the encrypted site.

# ---- Tell the app its own address -------------------------------------------
# Links in emails — activation, password reset — are built from this, and they were pointing at
# the bare IP over http.
echo "==> Recording the public address"
touch "$ENV_FILE"
if grep -q '^APP_BASE_URL=' "$ENV_FILE"; then
  sed -i "s#^APP_BASE_URL=.*#APP_BASE_URL=https://$PRIMARY#" "$ENV_FILE"
else
  echo "APP_BASE_URL=https://$PRIMARY" >> "$ENV_FILE"
fi

# A session secret that survives restarts. Without one the server generates a new secret each time
# it starts, which signs everybody out on every deploy.
if ! grep -q '^SESSION_SECRET=' "$ENV_FILE"; then
  echo "==> Generating a permanent SESSION_SECRET"
  echo "SESSION_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n=' )" >> "$ENV_FILE"
fi

chown root:masjidpoint "$ENV_FILE" 2>/dev/null || true
chmod 640 "$ENV_FILE"
systemctl restart masjidpoint

# ---- Report -----------------------------------------------------------------
sleep 2
echo
if curl -fsS --max-time 10 "https://$PRIMARY/api/state" >/dev/null; then
  echo "================================================================"
  echo " MasjidPoint is served over HTTPS."
  echo
  echo "   https://$PRIMARY"
  echo
  echo " Plain http now redirects here. The certificate renews itself;"
  echo " check with:  sudo certbot renew --dry-run"
  echo "================================================================"
else
  echo "The certificate is installed but the site did not answer over https." >&2
  echo "What nginx says:" >&2; nginx -t >&2 || true
  echo "What the app says:" >&2; journalctl -u masjidpoint -n 20 --no-pager >&2
  exit 1
fi

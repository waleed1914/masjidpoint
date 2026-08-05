# Putting MasjidPoint on an EC2 instance

For getting the platform online at a fixed address that survives reboots. It runs in the
development JSON mode behind a shared password — see [PRODUCTION.md](PRODUCTION.md) for what has to
change before real money moves through it.

## What you need

- A running EC2 instance (t3.micro is enough), Ubuntu 22.04/24.04 or Amazon Linux 2023
- Its Elastic IP
- The `.pem` key file downloaded when you created the instance
- Security group allowing SSH (22) from your IP, and HTTP (80) and HTTPS (443) from anywhere

## 1. Connect

From PowerShell on your PC, in the folder holding the `.pem`:

```powershell
icacls masjidpoint.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"   # once: SSH refuses a world-readable key
ssh -i masjidpoint.pem ubuntu@YOUR-ELASTIC-IP        # Ubuntu
ssh -i masjidpoint.pem ec2-user@YOUR-ELASTIC-IP      # Amazon Linux
```

## 2. Run the setup

```bash
curl -fsSLO https://raw.githubusercontent.com/waleed1914/masjidpoint/main/scripts/ec2-setup.sh
sudo bash ec2-setup.sh
```

The repository is private, so the first run stops and prints a deploy key. Add it at
**github.com/waleed1914/masjidpoint → Settings → Deploy keys → Add deploy key**, leave *Allow write
access* unticked, then run `sudo bash ec2-setup.sh` again.

A deploy key rather than a personal access token: it grants one repository, read only, and revoking
it affects nothing else.

When it finishes it prints the address, username and password.

## 3. Check it

Open `http://YOUR-ELASTIC-IP`. The browser asks for the username and password it printed.

```bash
sudo systemctl status masjidpoint     # is it running
sudo journalctl -u masjidpoint -f     # what it is doing
```

It starts on boot and restarts if it crashes, so the site stays up without you.

## Updating after a change

Push to `main` on your PC, then on the server:

```bash
sudo bash /opt/masjidpoint/scripts/ec2-setup.sh
```

Same script: it pulls, reinstalls, and restarts. The password in `/etc/masjidpoint.env` is kept, so
a link you have already sent keeps working.

## Adding a domain and HTTPS

Point an A record at the Elastic IP, wait for it to resolve, then:

```bash
sudo apt install -y certbot python3-certbot-nginx    # Ubuntu
sudo certbot --nginx -d masjidpoint.co.uk -d www.masjidpoint.co.uk
```

Certbot edits the nginx config and renews by itself. On Amazon Linux certbot is not in the default
repositories and needs installing through pip — one of the reasons Ubuntu is the easier choice here.

## Where things are

| | |
|---|---|
| Code | `/opt/masjidpoint` |
| Data | `/opt/masjidpoint/data/masjidpoint.json` |
| Uploads | `/opt/masjidpoint/data/uploads` |
| Password and port | `/etc/masjidpoint.env` |
| Service | `/etc/systemd/system/masjidpoint.service` |
| nginx | `sites-available/masjidpoint` (Ubuntu) or `conf.d/masjidpoint.conf` (Amazon Linux) |

## Backing it up

The whole platform is one JSON file plus the uploads directory. From your PC:

```powershell
scp -i masjidpoint.pem ubuntu@YOUR-ELASTIC-IP:/opt/masjidpoint/data/masjidpoint.json .
```

Worth doing before every update until PostgreSQL is in place.

## Before this takes real payments

Two API holes make the shared password the only thing protecting the data:

- `GET /api/state` returns every record, including password hashes
- `PUT /api/collection/<key>` replaces a whole collection without authenticating

Both need fixing, along with PostgreSQL and SMTP from [PRODUCTION.md](PRODUCTION.md), before the
password gate comes off.

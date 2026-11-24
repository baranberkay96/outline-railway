#!/bin/sh
# Start Dex as Outline's login provider on Railway.
# Builds the Dex config from variables on every start: one OAuth client (Outline)
# and static e-mail/password users (the admin plus optional DEX_EXTRA_USERS).
# Bad values never stop the start: they fall back to safe defaults and say why.
set -u

log() { echo "[railway] $*"; }

CONFIG=/var/dex/config.yaml
MIN_PASSWORD=12

random_secret() { head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-40; }
valid_email() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; }
bcrypt() { printf '%s\n' "$1" | htpasswd -niB -C 10 user | cut -d: -f2-; }
user_id() { printf '%s' "$1" | sha256sum | cut -c1-32; }
user_name() { printf '%s' "${1%%@*}" | tr -cd 'A-Za-z0-9._-' | cut -c1-60; }

case "${PORT:-}" in
  ''|*[!0-9]*) log "PORT '${PORT:-}' is not a number; using 5556"; PORT=5556 ;;
esac

OUTLINE_URL="${OUTLINE_URL:-}"
OUTLINE_URL="${OUTLINE_URL%/}"
case "$OUTLINE_URL" in
  http://*|https://*) ;;
  *) log "WARNING: OUTLINE_URL '${OUTLINE_URL}' is not a URL; Outline sign-in will fail until it is set"; OUTLINE_URL="https://invalid.example" ;;
esac
OUTLINE_HOST="${OUTLINE_URL#*://}"
OUTLINE_HOST="${OUTLINE_HOST%%/*}"
OUTLINE_HOST="${OUTLINE_HOST%%:*}"

ISSUER="${DEX_ISSUER:-}"
ISSUER="${ISSUER%/}"
case "$ISSUER" in
  http://*|https://*) ;;
  *) ISSUER="https://${RAILWAY_PUBLIC_DOMAIN:-localhost}"; log "DEX_ISSUER not set; using ${ISSUER}" ;;
esac

CLIENT_ID="${OIDC_CLIENT_ID:-outline}"
case "$CLIENT_ID" in
  *[!A-Za-z0-9._-]*|'') log "OIDC_CLIENT_ID '${CLIENT_ID}' has unsupported characters; using 'outline'"; CLIENT_ID=outline ;;
esac
CLIENT_SECRET="${OIDC_CLIENT_SECRET:-}"
if [ "${#CLIENT_SECRET}" -lt 16 ] || printf '%s' "$CLIENT_SECRET" | grep -q '[^A-Za-z0-9._~-]'; then
  log "WARNING: OIDC_CLIENT_SECRET is missing, shorter than 16 characters or has unsupported characters."
  log "         Outline cannot sign in until Dex and Outline share a valid secret (letters and digits, 16+)."
  CLIENT_SECRET="$(random_secret)"
fi

USERS_YAML=""
SEEN=" "
add_user() { # email password label
  email=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
  password=$2
  label=$3
  if ! valid_email "$email"; then
    log "WARNING: ${label}: '${email}' is not an e-mail address; skipped"
    return 1
  fi
  case "$SEEN" in *" $email "*) log "WARNING: ${label}: ${email} is listed twice; skipped"; return 1 ;; esac
  if [ "${#password}" -lt "$MIN_PASSWORD" ]; then
    log "WARNING: ${label}: the password for ${email} is shorter than ${MIN_PASSWORD} characters."
    log "         The login is locked with a random password until you set a longer one and redeploy Dex."
    password=$(random_secret)
  fi
  hash=$(bcrypt "$password")
  name=$(user_name "$email")
  [ -n "$name" ] || name=user
  USERS_YAML="${USERS_YAML}
  - email: \"${email}\"
    hash: \"${hash}\"
    username: \"${name}\"
    preferredUsername: \"${name}\"
    emailVerified: true
    userID: \"$(user_id "$email")\""
  SEEN="${SEEN}${email} "
  return 0
}

ADMIN_EMAIL=$(printf '%s' "${OUTLINE_ADMIN_EMAIL:-}" | tr -d ' \t\r\n' | tr 'A-Z' 'a-z')
if ! valid_email "$ADMIN_EMAIL"; then
  log "WARNING: OUTLINE_ADMIN_EMAIL '${ADMIN_EMAIL}' is not an e-mail address; using admin@${OUTLINE_HOST}"
  ADMIN_EMAIL="admin@${OUTLINE_HOST}"
fi
add_user "$ADMIN_EMAIL" "${OUTLINE_ADMIN_PASSWORD:-}" "OUTLINE_ADMIN_PASSWORD" || true

# DEX_EXTRA_USERS: "alice@example.com:password1, bob@example.com:password2"
extra_count=0
for entry in $(printf '%s' "${DEX_EXTRA_USERS:-}" | tr ',;\r\n\t' '     '); do
  case "$entry" in
    *:*) add_user "${entry%%:*}" "${entry#*:}" "DEX_EXTRA_USERS" && extra_count=$((extra_count + 1)) ;;
    *) log "WARNING: DEX_EXTRA_USERS entry without ':' skipped (format: email:password)" ;;
  esac
done

cat > "$CONFIG" <<EOF
issuer: "${ISSUER}"
storage:
  type: memory
web:
  http: "[::]:${PORT}"
frontend:
  issuer: "Outline"
  theme: light
oauth2:
  skipApprovalScreen: true
  responseTypes: ["code"]
logger:
  level: info
  format: text
enablePasswordDB: true
staticClients:
  - id: "${CLIENT_ID}"
    name: "Outline"
    secret: "${CLIENT_SECRET}"
    redirectURIs:
      - "${OUTLINE_URL}/auth/oidc.callback"
staticPasswords:${USERS_YAML:- []}
EOF
chmod 600 "$CONFIG"

log "issuer ${ISSUER}; client '${CLIENT_ID}' -> ${OUTLINE_URL}/auth/oidc.callback"
log "admin login: ${ADMIN_EMAIL}; extra users: ${extra_count}"
exec /usr/local/bin/dex serve "$CONFIG"

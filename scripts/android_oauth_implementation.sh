#!/usr/bin/env bash
#
# MilkOS Android OAuth + Android readiness master script
#
# Safe automatic mode:
#   - inspects the repository and records a report
#   - backs up a file before any narrowly-scoped automatic edit
#   - only applies the Android callback intent-filter when the manifest is
#     unambiguous and the exact expected MainActivity is present
#   - never edits backend authentication or frontend login code speculatively
#   - runs available tests/builds only after the relevant prerequisites pass
#
# Usage:
#   chmod +x scripts/android_oauth_implementation.sh
#   ./scripts/android_oauth_implementation.sh
#
set -Eeuo pipefail
IFS=$'\n\t'

APP_ROOT="${MILKOS_ROOT:-$HOME/milkos}"
REPORT_DIR="${APP_ROOT}/reports"
STAMP="$(date +%Y%m%d_%H%M%S)"
REPORT="${REPORT_DIR}/android_oauth_readiness_${STAMP}.log"
BACKUP_DIR="${APP_ROOT}/.safe-backups/android-oauth-${STAMP}"
SKIP_BUILD=0
CHANGED=0
BLOCKERS=0
WARNINGS=0

usage() {
  cat <<'USAGE'
MilkOS Android OAuth safe implementation and readiness check

Usage:
  ./scripts/android_oauth_implementation.sh [--skip-build] [--help]

Environment:
  MILKOS_ROOT   Repository path (default: ~/milkos)

The script does not stage, commit, push, reset, clean, or delete files.
It does not print OAuth secrets. It only applies a narrowly-scoped Android
manifest deep-link edit when the manifest structure is unambiguous.
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

mkdir -p "$REPORT_DIR"
exec > >(tee -a "$REPORT") 2>&1

section() { printf '\n\n========== %s ==========\n' "$1"; }
ok() { printf '[PASS] %s\n' "$1"; }
warn() { WARNINGS=$((WARNINGS + 1)); printf '[WARN] %s\n' "$1"; }
block() { BLOCKERS=$((BLOCKERS + 1)); printf '[BLOCKER] %s\n' "$1"; }
info() { printf '[INFO] %s\n' "$1"; }

backup_file() {
  local file="$1"
  mkdir -p "$BACKUP_DIR"
  local rel="${file#"$APP_ROOT"/}"
  mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
  cp -p "$file" "$BACKUP_DIR/$rel"
  info "Backed up $rel to $BACKUP_DIR/$rel"
}

stop_if_blocked() {
  if (( BLOCKERS > 0 )); then
    section "SAFE STOP"
    echo "The script found $BLOCKERS blocker(s). No further implementation/build steps will run."
    echo "Review the report: $REPORT"
    exit 20
  fi
}

section "PROJECT PREFLIGHT"
if [[ ! -d "$APP_ROOT/.git" ]]; then
  echo "Repository not found at: $APP_ROOT" >&2
  echo "Set MILKOS_ROOT to the correct repository path and rerun." >&2
  exit 2
fi
cd "$APP_ROOT"
ok "Repository found: $APP_ROOT"
printf 'Timestamp: %s\n' "$STAMP"
printf 'Branch: '
git branch --show-current || true
echo
echo "Git status (read-only):"
git status --short || true
echo
echo "Unstaged change summary:"
git diff --stat || true
echo
echo "Staged change summary:"
git diff --cached --stat || true
warn "Existing Git changes are preserved. This script will not stage, commit, push, reset, or clean anything."

section "TOOLCHAIN"
for cmd in git node pnpm npm python python3; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf '%-10s %s\n' "$cmd" "$(command -v "$cmd")"
  else
    warn "Optional tool not found: $cmd"
  fi
done
node --version 2>/dev/null || true
pnpm --version 2>/dev/null || true
python3 --version 2>/dev/null || true

section "PROJECT STRUCTURE"
for path in \
  package.json pnpm-lock.yaml capacitor.config.ts \
  android/app/src/main/AndroidManifest.xml \
  android/app/src/main/java/com/milkos/app/MainActivity.java \
  backend/app/api/routers/auth.py \
  backend/app/infrastructure/gateways/google_oauth.py \
  backend/app/infrastructure/db/models/native_oauth.py \
  backend/migrations/versions/91c4e8d2f6a1_native_oauth_transactions.py \
  app/'(auth)'/_components/login-form.tsx \
  lib/account/api.ts lib/auth.ts
do
  if [[ -e "$path" ]]; then ok "Found $path"; else warn "Missing expected path: $path"; fi
done

section "CAPACITOR AND ANDROID CONFIGURATION"
if [[ -f capacitor.config.ts ]]; then
  sed -n '1,200p' capacitor.config.ts
else
  block "capacitor.config.ts is missing."
fi

MANIFEST="android/app/src/main/AndroidManifest.xml"
MAIN_ACTIVITY="android/app/src/main/java/com/milkos/app/MainActivity.java"
CALLBACK_URI="com.milkos.app://auth/google/callback"

if [[ -f "$MANIFEST" ]]; then
  echo "--- Android manifest activity and intent filters ---"
  grep -n -B5 -A22 -E 'MainActivity|android.intent.action.VIEW|com.milkos.app|android:launchMode' "$MANIFEST" || true

  if grep -Fq 'android:scheme="com.milkos.app"' "$MANIFEST" &&
     grep -Fq 'android:host="auth"' "$MANIFEST" &&
     grep -Fq 'android:path="/google/callback"' "$MANIFEST"; then
    ok "Manifest already contains the expected callback scheme/host/path."
  else
    info "Checking whether the expected deep-link filter can be safely added."
    if [[ -f "$MAIN_ACTIVITY" ]] &&
       grep -Eq 'package[[:space:]]+com\.milkos\.app[[:space:]]*;' "$MAIN_ACTIVITY" &&
       grep -Fq 'android:name=".MainActivity"' "$MANIFEST" &&
       grep -Fq '</activity>' "$MANIFEST"; then
      if grep -Fq 'android.intent.action.VIEW' "$MANIFEST"; then
        block "A VIEW intent-filter already exists but does not match the expected callback. Manual review is required; refusing to alter it."
      else
        backup_file "$MANIFEST"
        python3 - "$MANIFEST" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
needle = '        </activity>'
if text.count(needle) != 1:
    raise SystemExit("Expected exactly one MainActivity closing tag; refusing manifest edit.")
filter_xml = '''            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data
                    android:scheme="com.milkos.app"
                    android:host="auth"
                    android:path="/google/callback" />
            </intent-filter>
'''
text = text.replace(needle, filter_xml + needle, 1)
path.write_text(text)
PY
        CHANGED=$((CHANGED + 1))
        ok "Added the exact MilkOS Google callback intent-filter."
      fi
    else
      block "Cannot safely identify the MainActivity manifest structure; no manifest edit made."
    fi
  fi
else
  block "Android manifest is missing."
fi

if [[ -f "$MAIN_ACTIVITY" ]]; then
  echo "--- MainActivity.java ---"
  sed -n '1,120p' "$MAIN_ACTIVITY"
  if grep -Fq 'extends BridgeActivity' "$MAIN_ACTIVITY"; then
    ok "MainActivity extends Capacitor BridgeActivity."
  else
    block "MainActivity is not the expected Capacitor BridgeActivity."
  fi
fi

section "BACKEND OAUTH CONFIGURATION (VALUES REDACTED)"
if [[ -f backend/app/core/config.py ]]; then
  grep -n -E 'APP_URL|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|GOOGLE_NATIVE_REDIRECT_URI' backend/app/core/config.py \
    | sed -E 's/(GOOGLE_CLIENT_SECRET[^=]*=).*/\1 <redacted>/' || true
fi
if [[ -f backend/.env ]]; then
  python3 - backend/.env <<'PY'
from pathlib import Path
import sys
wanted = {"APP_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
          "GOOGLE_REDIRECT_URI", "GOOGLE_NATIVE_REDIRECT_URI"}
values = {}
for raw in Path(sys.argv[1]).read_text(errors="replace").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key in wanted:
        values[key] = value.strip().strip('"').strip("'")
for key in sorted(wanted):
    if key not in values:
        print(f"{key}: MISSING")
    elif key.endswith("_SECRET"):
        print(f"{key}: {'CONFIGURED' if values[key] else 'EMPTY'} (value hidden)")
    elif key.endswith("_CLIENT_ID"):
        print(f"{key}: {'CONFIGURED' if values[key] else 'EMPTY'} (value hidden)")
    else:
        print(f"{key}: {values[key] or 'EMPTY'}")
PY
else
  warn "backend/.env not found locally. Render configuration cannot be verified from this machine."
fi

if [[ -f backend/app/infrastructure/gateways/google_oauth.py ]]; then
  echo "--- OAuth gateway symbols ---"
  grep -n -E '^def |^async def |GOOGLE_.*REDIRECT_URI|code_challenge|code_verifier|email_for_native_code' \
    backend/app/infrastructure/gateways/google_oauth.py || true
  if grep -Fq 'def native_consent_url' backend/app/infrastructure/gateways/google_oauth.py &&
     grep -Fq 'async def email_for_native_code' backend/app/infrastructure/gateways/google_oauth.py; then
    ok "Native PKCE gateway helpers are present."
  else
    block "Native PKCE gateway helpers are incomplete. Refusing to invent/replace gateway code."
  fi
fi

section "NATIVE OAUTH DATABASE MODEL AND MIGRATION"
MODEL="backend/app/infrastructure/db/models/native_oauth.py"
MIGRATION="backend/migrations/versions/91c4e8d2f6a1_native_oauth_transactions.py"
if [[ -f "$MODEL" ]]; then
  grep -n -E '__tablename__|state_hash|pkce_verifier_encrypted|ticket_hash|expires_at|state_used_at|ticket_used_at' "$MODEL" || true
else
  block "Native OAuth transaction model is missing."
fi
if [[ -f "$MIGRATION" ]]; then
  grep -n -E 'revision|down_revision|native_oauth_transactions|state_hash|ticket_hash' "$MIGRATION" || true
else
  block "Native OAuth transaction migration is missing."
fi
if [[ -f backend/app/infrastructure/db/models/__init__.py ]] &&
   grep -Fq 'native_oauth' backend/app/infrastructure/db/models/__init__.py; then
  ok "Native OAuth model is registered."
else
  block "Native OAuth model registration is missing."
fi

section "NATIVE BACKEND ROUTE AUDIT"
AUTH_ROUTER="backend/app/api/routers/auth.py"
if [[ -f "$AUTH_ROUTER" ]]; then
  grep -n -E 'google/native|native.*google|oauth.*ticket|ticket.*exchange|NativeOAuthTransaction|native_consent_url|email_for_native_code' \
    "$AUTH_ROUTER" || true
  if grep -Eq 'google/native' "$AUTH_ROUTER" &&
     grep -Eq 'ticket|exchange' "$AUTH_ROUTER"; then
    ok "Some native OAuth routes appear to exist; detailed behavior still requires tests."
  else
    block "Native OAuth start/callback/ticket-exchange routes are not all detectable. Backend route implementation requires a reviewed patch; script will not rewrite the authentication router blindly."
  fi
else
  block "Backend auth router is missing."
fi

section "FRONTEND AND DEEP-LINK HANDLER AUDIT"
LOGIN="app/(auth)/_components/login-form.tsx"
if [[ -f "$LOGIN" ]]; then
  grep -n -E 'Sign in with Google|google/login|Browser.open|isNative|appUrlOpen|verifyMfaLogin|finish\(' "$LOGIN" || true
  if grep -Fq 'Browser.open' "$LOGIN" || grep -Fq 'nativeGoogle' "$LOGIN"; then
    ok "Login UI contains a possible native-browser OAuth flow."
  else
    block "Login UI has no detectable native-browser OAuth integration. Refusing to replace the existing login form."
  fi
else
  block "Login form file is missing."
fi

echo "--- Deep-link listeners in app/lib/components ---"
grep -R -n -E 'appUrlOpen|google/callback|Browser\.open|Browser\.close' \
  app lib components \
  --include='*.ts' --include='*.tsx' 2>/dev/null || true
if grep -R -q -E 'appUrlOpen.*google|google/callback' app lib components \
   --include='*.ts' --include='*.tsx' 2>/dev/null; then
  ok "A possible Google callback appUrlOpen handler exists."
else
  block "No Google callback appUrlOpen handler was detected."
fi

section "CAPACITOR PLUGINS AND ANDROID BUILD FILES"
if [[ -f package.json ]]; then
  node - <<'NODE'
const p = require('./package.json');
for (const name of ['@capacitor/core','@capacitor/android','@capacitor/app','@capacitor/browser']) {
  console.log(`${name}: ${p.dependencies?.[name] || p.devDependencies?.[name] || 'NOT DECLARED'}`);
}
console.log(`android:build script: ${p.scripts?.['android:build'] || 'NOT DEFINED'}`);
NODE
fi
for f in android/settings.gradle android/build.gradle android/app/build.gradle android/gradlew; do
  [[ -e "$f" ]] && ok "Found $f" || warn "Missing Android build file: $f"
done

section "GOOGLE OAUTH ROUTE AND REDIRECT CONFIGURATION"
echo "Expected production website callback:"
echo "  https://dairyflo.netlify.app/api/v1/auth/google/callback"
echo "Expected production Android backend callback:"
echo "  https://dairyflo.netlify.app/api/v1/auth/google/native/callback"
echo "Expected Android deep link:"
echo "  $CALLBACK_URI"
warn "Google Cloud Console and Render are external services; this local script cannot prove their saved settings or deployment health."

section "SAFE STOP CHECK"
stop_if_blocked

section "BACKEND TESTS"
if [[ -d backend ]]; then
  if [[ -x backend/.venv/bin/python ]]; then
    (
      cd backend
      .venv/bin/python -m compileall -q app
      .venv/bin/python -m pytest -q
    )
  elif command -v pytest >/dev/null 2>&1; then
    (cd backend && python3 -m compileall -q app && pytest -q)
  else
    warn "Backend Python environment/pytest not found; backend tests skipped."
  fi
else
  warn "Backend directory missing; backend tests skipped."
fi

section "FRONTEND CHECKS"
if [[ -f package.json ]] && command -v pnpm >/dev/null 2>&1; then
  if node -e "process.exit(require('./package.json').scripts?.lint ? 0 : 1)"; then
    pnpm lint
  else
    warn "No lint script defined; lint skipped."
  fi
  if (( SKIP_BUILD == 0 )); then
    pnpm build
  else
    warn "Build skipped by --skip-build."
  fi
else
  warn "pnpm/package.json unavailable; frontend checks skipped."
fi

section "CAPACITOR SYNC AND ANDROID BUILD"
if (( SKIP_BUILD == 0 )) && [[ -d android ]] && [[ -f package.json ]]; then
  if command -v npx >/dev/null 2>&1; then
    npx cap sync android
  else
    warn "npx not found; Capacitor sync skipped."
  fi
  if [[ -x android/gradlew ]]; then
    (
      cd android
      ./gradlew :app:assembleDebug
      ./gradlew :app:assembleRelease
    )
  else
    warn "Gradle wrapper unavailable; Android APK build skipped."
  fi
else
  warn "Android build skipped (requested or Android project missing)."
fi

section "APK OUTPUTS"
find android/app/build/outputs/apk -maxdepth 4 -type f -name '*.apk' -print 2>/dev/null || true
if [[ -f android/app/build/outputs/apk/debug/app-debug.apk ]]; then
  ok "Debug APK exists."
else
  warn "Debug APK not found."
fi
if [[ -f android/app/build/outputs/apk/release/app-release-unsigned.apk ]]; then
  warn "Release APK is unsigned. Configure release signing before distribution."
elif [[ -f android/app/build/outputs/apk/release/app-release.apk ]]; then
  ok "Release APK exists; verify signing before publishing."
else
  warn "No release APK found."
fi

section "FINAL SUMMARY"
printf 'Automatic manifest edits: %s\n' "$CHANGED"
printf 'Warnings: %s\n' "$WARNINGS"
printf 'Blockers: %s\n' "$BLOCKERS"
printf 'Backup directory: %s\n' "${BACKUP_DIR}"
printf 'Report: %s\n' "$REPORT"
echo
echo "This script does not claim Google sign-in works until the backend routes,"
echo "deep-link handler, MFA path, ticket exchange, and end-to-end APK test pass."
echo "No Git operations that modify repository history or index were performed."

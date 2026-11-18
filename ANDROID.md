# Building and releasing the MilkOS Android app

The app is a Capacitor shell around the static export of the Next.js app (`out/`). It talks to the API at
`https://milkos.onrender.com/api/v1` (see `.env.android`).

## One-time setup
1. Install JDK 21 and Android Studio (SDK 36).
2. Create a release keystore **once** and back it up somewhere safe (lose it = you can never update the app):
   `keytool -genkey -v -keystore ~/milkos-release.jks -alias milkos -keyalg RSA -keysize 2048 -validity 10000`
3. Add to `~/.gradle/gradle.properties` (never commit):
   ```
   MILKOS_RELEASE_STORE_FILE=/home/you/milkos-release.jks
   MILKOS_RELEASE_STORE_PASSWORD=...
   MILKOS_RELEASE_KEY_ALIAS=milkos
   MILKOS_RELEASE_KEY_PASSWORD=...
   ```
4. On Render set `CORS_ORIGINS` to include your web URL. `https://localhost` (the WebView origin) is always allowed.
5. Google sign-in: register `https://<api>/api/v1/auth/google/native/callback` in Google Cloud Console; the app returns via `milkos://oauth`.

## Build
```
pnpm install --frozen-lockfile
pnpm android:build                 # static export + cap sync
cd android
./gradlew assembleRelease          # APK  -> app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease            # AAB  -> app/build/outputs/bundle/release/app-release.aab (Play Store)
```
Bump `versionCode` (and `versionName`) in `android/app/build.gradle` for every release.

## Distribute
- **Direct APK:** upload `app-release.apk` as `milkos.apk` to a GitHub Release (or any host) and set
  `NEXT_PUBLIC_APK_URL` on Netlify to its URL so the landing-page button works.
- **Google Play:** create a Play Console account, upload the `.aab`, complete the store listing,
  Data safety form and content rating, then roll out to internal testing -> production.

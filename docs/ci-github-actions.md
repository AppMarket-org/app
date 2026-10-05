# Build Android and iOS apps in your own CI (#34, M3)

appmarket.org never builds or signs mobile apps and never stores keystores or certificates. Your
CI does that with your own keys, and uploads the result as a release (R13); buyers download it
through short-lived signed links (R14).

## 1. Get a CI token

Settings › CI tokens › create one (scopes include `releases:write`). Store it as the GitHub secret
`APPMARKET_TOKEN`.

## 2. Add the webhook

Repo page › Webhooks › Add webhook › **GitHub Actions**:

- **GitHub repository with the workflow**: `https://github.com/you/your-app-ci` (any repo you
  own; it only needs the workflow below).
- **GitHub fine-grained token**: only that repository, *Contents: read and write* (GitHub needs it
  to accept `repository_dispatch`). appmarket.org stores it encrypted and uses it for nothing else.

On every push of a branch or tag, appmarket.org sends a `repository_dispatch` event of type
`appmarket-push` with this `client_payload`:

| Field | Meaning |
| --- | --- |
| `repo` | `owner/slug` on appmarket.org |
| `ref` | e.g. `refs/tags/v1.2.0` or `refs/heads/main` |
| `before`, `after` | commits (before is null for a new ref) |
| `remote`, `token`, `tokenExpiresAt` | clone URL and a **read-only token valid for one hour** |
| `deliveryId`, `sentAt`, `event` | for logs |

The token is part of the event, so people who can read the workflow run can see it until it
expires. It only reads this repo.

## 3. The workflow (Android example)

```yaml
# .github/workflows/appmarket.yml
name: appmarket build
on:
  repository_dispatch:
    types: [appmarket-push]

jobs:
  android:
    # Release builds for version tags only.
    if: startsWith(github.event.client_payload.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - name: Clone from appmarket.org
        env: # Payload values go through env, never straight into the script.
          REMOTE: ${{ github.event.client_payload.remote }}
          TOKEN: ${{ github.event.client_payload.token }}
          SHA: ${{ github.event.client_payload.after }}
        run: |
          echo "::add-mask::$TOKEN"
          git init -q app && cd app
          git -c http.extraHeader="Authorization: Bearer $TOKEN" fetch -q --depth 1 "$REMOTE" "$SHA"
          git checkout -q FETCH_HEAD

      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }

      - name: Build and sign
        working-directory: app
        env: # Your keys, in your GitHub secrets.
          KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          echo "$KEYSTORE_BASE64" | base64 -d > "$RUNNER_TEMP/release.jks"
          ./gradlew assembleRelease \
            -Pandroid.injected.signing.store.file="$RUNNER_TEMP/release.jks" \
            -Pandroid.injected.signing.store.password="$KEYSTORE_PASSWORD" \
            -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
            -Pandroid.injected.signing.key.password="$KEY_PASSWORD"

      - name: Upload to appmarket.org
        env:
          APPMARKET_TOKEN: ${{ secrets.APPMARKET_TOKEN }}
          REPO: ${{ github.event.client_payload.repo }}
          REF: ${{ github.event.client_payload.ref }}
        run: |
          TAG="${REF#refs/tags/}"
          APK=app/app/build/outputs/apk/release/app-release.apk
          curl -fsS -X POST \
            "https://appmarket.org/api/repos/$REPO/releases?tag=$TAG&platform=android&filename=app.apk&sha256=$(sha256sum "$APK" | cut -d' ' -f1)" \
            -H "Authorization: Bearer $APPMARKET_TOKEN" \
            -H "Content-Type: application/octet-stream" \
            --data-binary @"$APK"
```

iOS works the same way on a `macos-latest` runner (or Codemagic, Expo EAS): build and sign with
your certificate from your CI's secrets, then upload the `.ipa` with `platform=ios`.

## Any other CI

Choose **Any URL** instead. appmarket.org POSTs the same payload as JSON and signs it:
`X-Appmarket-Signature-256: sha256=<HMAC-SHA256 of the body with your signing secret>`. Check it
before trusting the request. Buildkite, Codemagic and Jenkins accept such a call through a small
trigger endpoint of your own.

## Container apps

Build and push the image in CI, then pin it by digest in `wrangler.jsonc`; see [containers.md](containers.md).

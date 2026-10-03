# Device login for CLIs and agents (#104)

CLIs and AI agents sign in without handling passwords or pasting tokens, using the OAuth device
authorization grant (RFC 8628, Better Auth's `deviceAuthorization` plugin).

1. **Request a code.** `POST /api/auth/device/code` with `{"client_id": "appmarket-cli"}`. The response
   has `device_code` (keep it secret), `user_code`, `verification_uri`, `verification_uri_complete`,
   `expires_in` (600 s) and `interval` (5 s).
2. **Show the user** the `user_code` (as `XXXX-XXXX`) and `verification_uri_complete`
   (`https://appmarket.org/device?user_code=…`). They sign in if needed, check the code matches, and
   approve or deny.
3. **Poll** `POST /api/auth/device/token` every `interval` seconds with
   `{"grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "…", "client_id": "appmarket-cli"}`.
   Errors: `authorization_pending` (keep polling), `slow_down` (poll less often), `access_denied`,
   `expired_token`. On success: `{"access_token": "…", "token_type": "Bearer", "expires_in": …}`.
4. **Call the API** with `Authorization: Bearer <access_token>`. The token is a session for that user
   (7 days, renewed while used). Store it like a password (OS keychain).

Users see and sign out devices under **Settings → Signed-in devices** (`GET/DELETE /api/me/sessions`).

Allowed client ids are in `DEVICE_CLIENTS` (`apps/api/src/auth/options.ts`); unknown ids get
`invalid_client`. Approving requires the signed-in user to view the code first (`GET /api/auth/device`).

# Gmail sending setup

This backend connects each signed-in site user to their own Google account and sends one individual message per selected company. It requests only `gmail.send` and `userinfo.email`, uses OAuth state plus PKCE, and stores access and refresh tokens encrypted with AES-256-GCM.

## Runtime variables

Configure these as server-side Sites runtime variables. Do not commit them to the repository or expose them to browser code.

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client ID for a Google **Web application** client. |
| `GOOGLE_CLIENT_SECRET` | Secret for that OAuth client. |
| `GOOGLE_REDIRECT_URI` | Exact public callback URL, including `/api/email/callback`, `https://dublin-tech-compass.emeraldpathways.chatgpt.site/api/email/callback`. |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | Base64url-encoded 32-byte key used to encrypt stored Google tokens. |

Generate a fresh key with Node.js 22 or later:

```sh
node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'
```

Keep the key stable while users have saved Gmail connections. Replacing it makes existing tokens unreadable; rotate it only with a coordinated token re-encryption or after users disconnect and reconnect.

## Google Cloud configuration

In the [Google Cloud console](https://console.cloud.google.com/), enable the Gmail API and configure the OAuth consent screen. Create an OAuth client with application type **Web application** and add the exact `GOOGLE_REDIRECT_URI` value to its authorized redirect URIs. Google requires the scheme, host, path, and trailing slash to match exactly. For local testing, Google permits localhost redirect URIs; production callbacks should use HTTPS.

If the consent app is in **Testing**, add your Gmail account under **Audience → Test users**. External public use may require Google verification.

The site already has a generated encryption key and the correct redirect URI. Supply the client ID and client secret in the existing runtime fields and publish to apply them.

The authorization flow requests:

- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/userinfo.email`

The user starts the flow by navigating the browser to `/api/email/connect`. Google returns to `/api/email/callback`; a successful connection redirects to `/email?connected=true`, while a failure redirects to `/email?error=...`. A missing server configuration produces an actionable `503` response from the connect endpoint.

See Google's [OAuth 2.0 web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server) and [Gmail message sending guide](https://developers.google.com/workspace/gmail/api/guides/sending) for the provider-side setup and behavior.

## Sending behavior

`GET /api/email` reports configuration and connection state, owner-scoped company recipients, and the latest 100 delivery records. A recipient is selected from the exact imported `Email` header first, then recognized company email headers, then the first valid saved contact email.

`POST /api/email/send` accepts 1–20 unique companies and sends each message separately, so recipients never see one another. The panel sends one company per request, serially, and reuses the request ID across that selection. The entire request is validated before its first send. Delivery records are unique by owner, request ID, and company. Repeating a request ID returns the saved result and never automatically retries a sent, failed, or uncertain delivery. The UI should use a new request ID after its selection or message content changes.

Each Gmail send has a 15-second timeout; the route processes at most two sends concurrently. A Gmail response without a message ID, a timeout, or a lost response is recorded as `unknown` because delivery cannot be confirmed. These records are not automatically replayed.

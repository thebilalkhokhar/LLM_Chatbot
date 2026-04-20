# Backend — Express Gateway (Phase 3)

Production-style Express.js (ESM) gateway sitting in front of the Python
`ai-service`. It owns:

- **User auth** — access + refresh JWT pair, refresh delivered over an
  HttpOnly cookie, server-side revocation on logout.
- **Chat persistence** — MongoDB models for `User`, `Chat`, and
  `Message` (the latter matches the Python `ChatMessage` schema 1:1).
- **AI bridge** — forwards conversations to `ai-service/chat` with a
  small retry loop, and streams the answer back to the browser over
  Server-Sent Events.

## Folder Structure

```
backend/
├── package.json
├── .env.example
└── src/
    ├── server.js              # boot: DB connect + http.listen + graceful shutdown
    ├── app.js                 # express factory (middleware, CORS, routers, errors)
    ├── config/
    │   ├── constants.js       # MESSAGE_ROLES, SSE events, sizes — synced with Python
    │   ├── database.js        # mongoose connect + lifecycle hooks
    │   └── env.js             # typed env loader (reads backend/.env)
    ├── models/
    │   ├── user.model.js      # email/username/password(hash)/refreshToken
    │   ├── message.model.js   # { role, content, context, provider?, model? }
    │   └── chat.model.js      # { userId, title, messages[], active_pdf_id }
    ├── services/
    │   ├── token.service.js   # JWT pair + refresh cookie options
    │   └── ai.service.js      # axios call to Python /chat + retries + streaming
    ├── middleware/
    │   ├── auth.middleware.js # verifyJWT (Bearer)
    │   └── error.middleware.js# 404 + centralized error handler
    ├── controllers/
    │   ├── auth.controller.js # signup / login / refresh / logout / me
    │   └── chat.controller.js # sendMessage (SSE), list / get / patch / delete
    ├── routes/
    │   ├── auth.routes.js     # /api/auth/*
    │   └── chat.routes.js     # /api/chat/*   (guarded)
    └── utils/
        ├── ApiError.js        # structured operational errors
        └── asyncHandler.js    # promise → next(err) wrapper
```

## Setup

```powershell
cd backend
npm install
Copy-Item .env.example .env
# then edit .env and set real values (especially the JWT secrets)
```

Generate strong JWT secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Run

Start MongoDB locally (or point `MONGO_URI` at a remote cluster), start
the Python `ai-service`, then:

```powershell
npm run dev      # nodemon (auto-reload)
# or
npm start
```

Server listens on `http://localhost:4000` by default.

## Endpoints

### Auth — `/api/auth`

| Method | Path        | Auth         | Purpose                                    |
|--------|-------------|--------------|--------------------------------------------|
| POST   | `/signup`   | — (public)   | Create account → sets refresh cookie + returns access token |
| POST   | `/login`    | — (public)   | Same response shape as `/signup`           |
| POST   | `/refresh`  | cookie-only  | Rotate the token pair (single-use refresh) |
| POST   | `/logout`   | — (public)   | Clear cookie + invalidate stored refresh   |
| GET    | `/me`       | Bearer       | Echo back the authenticated user           |

### Chat — `/api/chat` (all routes require `Authorization: Bearer …`)

| Method | Path      | Purpose                                                                    |
|--------|-----------|----------------------------------------------------------------------------|
| POST   | `/`       | Send a user message. Response is `text/event-stream` (see SSE below).      |
| GET    | `/`       | List the user's chats (light summaries).                                   |
| GET    | `/:id`    | Full message history for one chat.                                         |
| PATCH  | `/:id`    | Update `title` and/or `active_pdf_id`.                                     |
| DELETE | `/:id`    | Remove one chat thread.                                                    |

### SSE wire protocol for `POST /api/chat`

```text
event: reply
data: { "reply": "...", "provider": "gemini", "model": "gemini-2.5-flash", "next_step": "END" }

event: done
data: { "chatId": "65f…", "messageId": "65f…" }
```

On upstream failure:

```text
event: error
data: { "message": "...", "code": "AI_SERVICE_UNREACHABLE", "statusCode": 503 }
```

## Schema sync with Python

The `Message` subdoc MUST stay aligned with
`ai-service/app/schemas/chat_schema.py::ChatMessage`:

| Field     | Node (Mongoose)                | Python (Pydantic)             |
|-----------|--------------------------------|-------------------------------|
| `role`    | enum from `MESSAGE_ROLE_VALUES`| `Literal["system","user","assistant"]` |
| `content` | `String (required, trimmed)`   | `str (min_length=1)`          |
| `context` | `Mixed` (free-form dict)       | `dict` (used for `pdf_id` etc.) |

The bridge (`src/services/ai.service.js::mapMessagesToPython`) filters
out empty messages and passes only `{ role, content }` — extra Node-side
fields like `provider` / `model` / `_id` are deliberately dropped so the
Python endpoint's validator never rejects them.

## Quick smoke test

1. **Signup**:

   ```powershell
   curl -i -X POST http://localhost:4000/api/auth/signup `
     -H "Content-Type: application/json" `
     -d '{"email":"a@b.co","username":"alice","password":"pass12345"}'
   ```

   Grab the `accessToken` from the JSON body and the `refreshToken`
   cookie from the `Set-Cookie` header.

2. **Send a chat** (SSE — use `curl -N` to keep the stream open):

   ```powershell
   curl -N -X POST http://localhost:4000/api/chat `
     -H "Content-Type: application/json" `
     -H "Authorization: Bearer <accessToken>" `
     -d '{"content":"Hello!"}'
   ```

3. **List chats**:

   ```powershell
   curl http://localhost:4000/api/chat -H "Authorization: Bearer <accessToken>"
   ```

## Security notes

- Cookies: `HttpOnly`, `SameSite=Strict`, `Secure=true` in production.
  Flip `COOKIE_SECURE=true` in `.env` when running behind HTTPS.
- `helmet` sets safe default headers.
- CORS is opt-in per origin via `CORS_ORIGINS` (comma-separated). `*`
  is NOT allowed because `credentials: true` is on.
- Refresh tokens are single-use (rotated on every `/refresh`). Reusing
  an old one triggers server-side revocation of the entire session.
- All 500-class errors log full stack traces server-side but never
  leak them to clients.

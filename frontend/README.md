# Frontend — Next.js 15 + Tailwind v4

A premium, minimalist chat UI (inspired by Linear / ChatGPT) that talks to
the Node.js gateway at `http://localhost:4000/api`.

## Stack

- **Next.js 15** (App Router, Turbopack)
- **React 19** + **TypeScript 5**
- **Tailwind CSS v4** with custom design tokens (`@theme` in `globals.css`)
- **Axios** with a 401 → refresh → retry interceptor
- **Lucide React** icons, **clsx** + **tailwind-merge**

## Folder structure

```
frontend/
├── package.json
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── .env.local.example
└── src/
    ├── app/
    │   ├── layout.tsx            # root — wraps <AuthProvider>
    │   ├── page.tsx              # redirects based on auth state
    │   ├── globals.css           # Tailwind v4 + theme tokens
    │   ├── login/page.tsx
    │   ├── signup/page.tsx
    │   └── chat/
    │       ├── layout.tsx        # protected guard
    │       └── page.tsx          # sidebar + chat window
    ├── components/
    │   ├── ui/                   # Button, Input, Label
    │   ├── Sidebar.tsx
    │   ├── ChatWindow.tsx
    │   └── MessageBubble.tsx
    ├── context/
    │   └── AuthContext.tsx
    ├── lib/
    │   ├── api-client.ts         # axios + token management
    │   └── utils.ts              # cn, formatTime, EMAIL_REGEX
    └── types/
        └── index.ts
```

## Getting started

```powershell
cd frontend
npm install
Copy-Item .env.local.example .env.local   # already created by scaffolding
npm run dev
```

The app runs at <http://localhost:3000>.

The backend must be running at `http://localhost:4000` (see
`backend/README.md`). Make sure `CORS_ORIGINS` on the gateway includes
`http://localhost:3000` so the browser is allowed to send cookies.

## Auth flow

1. On mount, `AuthProvider` calls `POST /auth/refresh`. If the browser
   already has a valid HttpOnly refresh cookie, the server returns a
   fresh access token and the user is hydrated via `GET /auth/me`.
2. `login` / `signup` store the access token in memory (via
   `setAccessToken`) and let the interceptor attach it as
   `Authorization: Bearer …` to every API call.
3. Any 401 response triggers a one-shot refresh. If the refresh
   succeeds, the original request is retried transparently. If it
   fails, the user is marked as `unauthenticated` and the `/chat`
   guard redirects them to `/login`.

The access token **never** touches `localStorage` — only memory. The
refresh token stays in an `HttpOnly` cookie set by the Node gateway.

## Routes

| Path      | Auth required? | What it does                                  |
| --------- | -------------- | --------------------------------------------- |
| `/`       | —              | Redirects to `/chat` or `/login` by state     |
| `/login`  | No             | Email + password form                         |
| `/signup` | No             | Email + username + password form              |
| `/chat`   | **Yes**        | Sidebar (mock data) + ChatWindow              |

## What's wired in Phase 4 (this phase)

- Full auth round-trip with the Node gateway (signup, login, refresh, logout, me).
- Axios interceptor that auto-refreshes on 401.
- Guarded `/chat` route.
- Polished UI: glass auth cards, custom dark theme, Sidebar + ChatWindow.

## What's *not* wired yet (Phase 5)

- `onSend` in `app/chat/page.tsx` is a stub — it pushes local messages
  only. The real `useChatStream` hook (consuming SSE from
  `POST /api/chat`) will land next.
- Sidebar shows mock chats; switch to `GET /api/chat` in the next phase.
- PDF upload wiring to `POST /upload` on the Python service.

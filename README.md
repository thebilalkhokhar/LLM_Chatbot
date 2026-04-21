# LLM Chatbot — Full-Stack RAG Platform

A production-style ChatGPT-like application built on top of Google
Gemini, with a three-tier architecture:

```
┌──────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Next.js 15      │  →  │  Node.js / Expr. │  →  │  Python / FastAPI │
│  (Frontend UI)   │     │  (Auth + Gateway)│     │  (LangGraph + RAG)│
│  Port 3000       │     │  Port 4000       │     │  Port 8000        │
└──────────────────┘     └──────────────────┘     └───────────────────┘
                                │                          │
                                ▼                          ▼
                          ┌──────────┐              ┌──────────┐
                          │ MongoDB  │              │  FAISS   │
                          │ (users + │              │ (vectors)│
                          │  chats)  │              │          │
                          └──────────┘              └──────────┘
```

Real-time token streaming flows Gemini → FastAPI (NDJSON) →
Node gateway (SSE) → browser (`ReadableStream`), so the user sees the
answer being typed character by character.

---

## Features

- **Multi-user auth** — signup / login / logout with JWT access tokens
  (15 min) + HttpOnly refresh cookies (7 days). Single-use refresh
  rotation with server-side revocation.
- **Real-time streaming** — Gemini tokens streamed end-to-end over SSE;
  a stop button aborts generation mid-flight.
- **RAG over PDFs** — upload a PDF, get a `vector_id`, ask grounded
  questions. FAISS indices are persisted to disk per-vector.
- **Chat persistence** — every turn stored in MongoDB; full history is
  hydrated when switching threads.
- **Auto chat-titling** — the first turn of a new thread is summarized
  into a 3–5 word sidebar title via a background Gemini call.
- **Premium dark UI** — Next.js 15 + Tailwind v4, markdown rendering
  (`react-markdown` + GFM), VS Code-style syntax highlighting
  (`react-syntax-highlighter`), glassmorphism auth screens, mobile
  hamburger, skeleton loaders.

---

## Repository layout

```
LLM Project/
├── ai-service/       # Python · FastAPI · LangGraph · Gemini · FAISS
├── backend/          # Node.js · Express (ESM) · MongoDB · JWT
├── frontend/         # Next.js 15 · React 19 · Tailwind v4
└── README.md         # ← you are here
```

Each sub-project has its own `README.md` and `.env.example`.

---

## Tech stack

| Layer      | Stack                                                                                                     |
|------------|-----------------------------------------------------------------------------------------------------------|
| AI service | Python 3.11+, FastAPI, Uvicorn, LangGraph, LangChain, `langchain-google-genai`, FAISS, PyPDF, Pydantic v2 |
| LLM        | Google Gemini (`gemini-2.5-flash-lite` by default) + `gemini-embedding-001`                               |
| Gateway    | Node.js 20+, Express.js (ESM), MongoDB + Mongoose, `jsonwebtoken`, `bcryptjs`, `axios`, Helmet, Morgan    |
| Frontend   | Next.js 15 (App Router), React 19, TypeScript 5, Tailwind CSS v4, Axios, Lucide React                     |
| UX extras  | `react-markdown` + `remark-gfm`, `react-syntax-highlighter` (Prism / oneDark), `clsx` + `tailwind-merge`  |

---

## Prerequisites

- **Node.js** ≥ 20
- **Python** ≥ 3.11
- **MongoDB** running locally, or a remote URI
- **Google Gemini API key** — create one at
  <https://aistudio.google.com/apikey>

---

## Quick start

Open three terminals, one per service.

### 1. AI service — FastAPI

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# edit .env → set GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```

Health check: <http://localhost:8000/health>

### 2. Backend — Node gateway

```powershell
cd backend
npm install
Copy-Item .env.example .env
# edit .env → set MONGO_URI + JWT_ACCESS_SECRET + JWT_REFRESH_SECRET
npm run dev
```

Generate strong JWT secrets in one line:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Health check: <http://localhost:4000/api/health>

### 3. Frontend — Next.js

```powershell
cd frontend
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

Open <http://localhost:3000> and sign up.

---

## Environment variables (short)

| File                  | Required keys                                                                              |
|-----------------------|--------------------------------------------------------------------------------------------|
| `ai-service/.env`     | `GEMINI_API_KEY`, `GEMINI_MODEL`, `EMBEDDING_MODEL`                                        |
| `backend/.env`        | `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AI_SERVICE_URL`, `CORS_ORIGINS`   |
| `frontend/.env.local` | `NEXT_PUBLIC_API_BASE_URL` (defaults to `http://localhost:4000/api`)                       |

See each `*/.env.example` for the full list with comments.

---

## How a request flows

1. User types into `ChatWindow` and presses **Enter**.
2. `useChat` hook opens `POST /api/chat` via the Fetch API
   (`ReadableStream` — streaming needs it; axios doesn't do it well).
3. The **Node gateway** authenticates the JWT, loads the thread from
   MongoDB, maps history to the Python schema, and opens
   `POST /chat/stream` on the AI service.
4. The **AI service**:
   - Runs `retriever_node` — if the chat has an `active_pdf_id`,
     relevant FAISS chunks are appended to the state's `context`.
   - Streams Gemini tokens as NDJSON (`{"event":"start"}`,
     `{"token":"..."}`, `{"event":"done"}`).
5. Node re-emits each line as an SSE frame to the browser.
6. `useChat` parses SSE and appends deltas to the last assistant
   message in-place → the user sees real-time typing.
7. When the stream ends, the Node gateway persists the full
   `{user, assistant}` turn to MongoDB. If it was the first turn on a
   new thread, a background **auto-title** call kicks off and the
   sidebar label updates.

---

## Public API surface

### AI service (FastAPI, port 8000)

| Method | Path           | Purpose                                                      |
|--------|----------------|--------------------------------------------------------------|
| POST   | `/chat`        | One-shot chat turn (JSON)                                    |
| POST   | `/chat/stream` | Streamed chat turn (`application/x-ndjson`)                  |
| POST   | `/upload`      | Ingest a PDF → FAISS index → returns `{ vector_id, chunks }` |
| GET    | `/health`      | Liveness                                                     |

### Node gateway (Express, port 4000)

| Method | Path                        | Auth    | Purpose                               |
|--------|-----------------------------|---------|---------------------------------------|
| POST   | `/api/auth/signup`          | public  | Create account                        |
| POST   | `/api/auth/login`           | public  | Log in                                |
| POST   | `/api/auth/refresh`         | cookie  | Rotate token pair                     |
| POST   | `/api/auth/logout`          | public  | Clear cookie + revoke refresh         |
| GET    | `/api/auth/me`              | bearer  | Current user                          |
| POST   | `/api/chat`                 | bearer  | Send a message (SSE response)         |
| GET    | `/api/chat` · `/threads`    | bearer  | List threads                          |
| GET    | `/api/chat/:id`             | bearer  | Full thread history                   |
| PATCH  | `/api/chat/:id`             | bearer  | Update title / active PDF             |
| DELETE | `/api/chat/:id`             | bearer  | Delete thread                         |
| POST   | `/api/chat/upload`          | bearer  | Proxy PDF upload to AI service        |
| POST   | `/api/chat/title`           | bearer  | Auto-generate a thread title          |

---

## Project structure (detailed)

```
ai-service/
├── app/
│   ├── api/           # chat_routes.py, upload_api.py
│   ├── core/          # config (reads ai-service/.env)
│   ├── graph/
│   │   ├── graph.py   # START → retriever_node → chat_node → END
│   │   ├── state.py
│   │   └── nodes/     # chat_node.py, retriever_node.py
│   ├── rag/           # vector_store.py, ingest.py
│   ├── schemas/       # Pydantic request/response models
│   ├── services/      # llm.py, chat_service.py (stream_chat)
│   └── main.py
├── storage/vectors/   # FAISS indices (gitignored)
└── requirements.txt

backend/src/
├── config/            # env.js, database.js, constants.js
├── controllers/       # auth.controller.js, chat.controller.js
├── middleware/        # auth.middleware.js, error.middleware.js
├── models/            # user, chat, message (role sync with Python)
├── routes/            # auth.routes.js, chat.routes.js
├── services/          # token.service.js, ai.service.js
├── utils/             # ApiError, asyncHandler
├── app.js             # express factory
└── server.js          # DB connect + listen + graceful shutdown

frontend/src/
├── app/               # /login, /signup, /chat (App Router)
├── components/        # Sidebar, ChatWindow, MessageBubble, FileUpload, ui/*
├── context/           # AuthContext (user + accessToken + refresh logic)
├── hooks/             # useChat (Fetch + ReadableStream SSE parser)
├── lib/               # api-client (axios), sse parser, utils
├── services/          # chat.service.ts (CRUD wrappers)
└── types/             # shared TS types (mirrors backend schemas)
```

---

## Scripts

| Directory    | Command             | What it does               |
|--------------|---------------------|----------------------------|
| `ai-service` | `uvicorn …`         | Dev server (auto-reload)   |
| `backend`    | `npm run dev`       | nodemon (auto-reload)      |
| `backend`    | `npm start`         | Production start           |
| `frontend`   | `npm run dev`       | Next dev server            |
| `frontend`   | `npm run build`     | Production build           |
| `frontend`   | `npm run typecheck` | Strict TypeScript check    |

---

## Security notes

- Refresh tokens: **HttpOnly**, **SameSite=Strict**, **Secure** in
  production. Set `COOKIE_SECURE=true` in `backend/.env` behind HTTPS.
- Access tokens live only in React memory — never in localStorage.
- CORS is per-origin via `CORS_ORIGINS` (comma-separated). Wildcards
  are rejected because `credentials: true` is on.
- `helmet` sets safe default headers on the gateway.
- Refresh rotation: reusing a stale refresh token revokes the whole
  session server-side.
- Passwords hashed with `bcryptjs` (cost 12).

---

## Roadmap / known follow-ups

- Re-introduce tool-use (web search, calculator, stock price) behind
  `model.bind_tools` — previously present in a standalone prototype,
  not yet ported into the FastAPI graph.
- Hugging Face fallback provider (deferred — currently Gemini-only).
- Persist the original PDF filename on the chat document (today a
  reloaded thread shows "Attached document" as the badge label).
- Replace `window.confirm` for delete with a design-system dialog.
- E2E test harness (Playwright) over the streaming flow.

---

## License

Private / unlicensed — see the project owner.

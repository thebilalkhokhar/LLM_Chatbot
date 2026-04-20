# AI Service — Phase 2 (RAG)

FastAPI + LangGraph service powered by **Google Gemini** (chat + embeddings),
with a **PDF → FAISS RAG** pipeline.

> A HuggingFace fallback lived here in earlier iterations and may be
> reintroduced in a future phase. For now the service is Gemini-only.

## Folder Structure

```
ai-service/
├── requirements.txt
├── .env.example
├── storage/
│   └── vectors/               # FAISS indices persisted per upload
└── app/
    ├── main.py                # FastAPI app factory + router registration
    ├── api/
    │   ├── chat_routes.py     # POST /chat, GET /health
    │   └── upload_api.py      # POST /upload (PDF → vector_id)
    ├── schemas/
    │   ├── chat_schema.py     # ChatMessage / ChatRequest / ChatResponse
    │   └── upload_schema.py   # UploadResponse
    ├── services/
    │   ├── chat_service.py    # Graph execution + message mapping
    │   └── llm.py             # Gemini LLM wrapper (HF fallback planned later)
    ├── rag/
    │   ├── ingest.py          # PyPDFLoader + RecursiveCharacterTextSplitter
    │   └── vector_store.py    # VectorStoreManager (save/load FAISS)
    ├── graph/
    │   ├── graph.py           # START → retriever → chat → END
    │   ├── state.py           # AgentState TypedDict
    │   └── nodes/
    │       ├── retriever_node.py  # Pulls chunks from FAISS when pdf_id is set
    │       └── chat_node.py       # Context-aware LLM call
    └── core/
        └── config.py          # Env loading + typed Settings
```

### Layer Responsibilities

| Layer       | Contains                                            | Knows about           |
|-------------|-----------------------------------------------------|-----------------------|
| `api/`      | FastAPI routers, HTTP status mapping                | `schemas`, `services`, `rag` |
| `schemas/`  | Pydantic DTOs                                       | nothing internal      |
| `services/` | Business logic, LangGraph invocation, LLM access    | `graph`, `schemas`    |
| `rag/`      | PDF ingestion + FAISS persistence                   | `core.config`         |
| `graph/`    | LangGraph workflow, nodes, state                    | `services.llm`, `rag` |
| `core/`     | Settings, env loading, storage paths                | nothing internal      |

## Setup

1. **Create and activate a virtual environment** (from the repo root):

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

2. **Install dependencies**:

   ```powershell
   pip install -r ai-service/requirements.txt
   ```

3. **Configure environment variables**. The service loads **only**
   `ai-service/.env`. Use `.env.example` as a template:

   ```powershell
   Copy-Item ai-service\.env.example ai-service\.env
   ```

   Then edit `ai-service\.env` and paste your real credentials.
   The repo root no longer carries an `.env` file.

   Required keys:
   - `GEMINI_API_KEY` — powers both chat and embeddings

   Optional:
   - `GEMINI_MODEL` — defaults to `gemini-2.5-flash`
   - `EMBEDDING_MODEL` — defaults to `models/gemini-embedding-001`
   - `VECTOR_STORE_DIR` — defaults to `ai-service/storage/vectors`

## Run

```powershell
cd ai-service
uvicorn app.main:app --reload --port 8000
```

Open the interactive docs at <http://localhost:8000/docs>.

## Endpoints

| Method | Path      | Purpose                                                  |
|--------|-----------|----------------------------------------------------------|
| `GET`  | `/health` | Liveness probe                                           |
| `POST` | `/upload` | Upload a PDF, receive a `vector_id`                      |
| `POST` | `/chat`   | Run one chat turn (pass `context.pdf_id` to ground it)   |

## Quick Test — Plain chat

```powershell
curl -X POST http://localhost:8000/chat `
  -H "Content-Type: application/json" `
  -d '{ "messages": [{ "role": "user", "content": "Hello!" }] }'
```

## Quick Test — RAG flow

1. **Upload a PDF**:

   ```powershell
   curl -X POST http://localhost:8000/upload `
     -F "file=@C:\path\to\my-doc.pdf"
   ```

   Response:

   ```json
   {
     "vector_id": "9f3c…ab",
     "filename": "my-doc.pdf",
     "documents": 12,
     "chunks": 34,
     "status": "ok"
   }
   ```

2. **Ask a question grounded on the uploaded PDF** — pass `vector_id` as
   `context.pdf_id` on `/chat`:

   ```powershell
   curl -X POST http://localhost:8000/chat `
     -H "Content-Type: application/json" `
     -d '{
       "messages": [{ "role": "user", "content": "Summarize the document." }],
       "context": { "pdf_id": "9f3c…ab" }
     }'
   ```

   The reply will begin with **"Based on the document, …"** when context
   was retrieved.

## Behavior Notes

- On any exception from Gemini the chat pipeline returns a graceful
  "LLM unavailable" message instead of crashing.
- The retriever node silently no-ops when no `pdf_id` is present in the
  request context — so plain chat keeps working without any document.

## Next Phases

- HuggingFace fallback (deferred — to be added later)
- Tool-calling (web search, calculator, …)
- Persistent chat history via `SqliteSaver`
- Conditional routing via `next_step`

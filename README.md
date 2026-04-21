# Semantic Knowledge Copilot

Ask questions. Get answers grounded in your company's documents — with source citations.

## Architecture

```
User question
     │
     ▼
[React Frontend]  ──POST /query──▶  [FastAPI Backend]
                                          │
                              ┌───────────┴───────────┐
                              ▼                       ▼
                      Embed question           [RAG Engine]
                      via OpenAI                    │
                              │            Retrieve top-K chunks
                              ▼            from Pinecone (cosine sim)
                       Query Vector                  │
                       Store (Pinecone)      Build context block
                                                     │
                                            Call GPT-4o with
                                            grounded prompt
                                                     │
                                            Return answer +
                                            source citations
```

## Quickstart

### 1. Clone & configure

```bash
git clone <repo>
cd skc
cp backend/.env.example backend/.env
# Fill in your API keys in backend/.env
```

### 2. Get API Keys (free tiers work)

| Key | Where to get |
|-----|-------------|
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys |
| `PINECONE_API_KEY` | https://app.pinecone.io → API Keys tab (free tier) |

### 3. Run the backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend runs at: http://localhost:8000
API docs at: http://localhost:8000/docs

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at: http://localhost:5173

---

## Usage

1. Open http://localhost:5173
2. Drop a PDF/DOCX/TXT file in the sidebar
3. Wait for "indexed successfully" confirmation
4. Type your question and hit Enter

---

## API Reference

### Upload a document
```http
POST /ingest/upload
Content-Type: multipart/form-data

file: <your-file.pdf>
```

### Ask a question
```http
POST /query
Content-Type: application/json

{
  "question": "How do we handle customer refunds?",
  "top_k": 6
}
```

### Response
```json
{
  "answer": "According to the policy document [Source: 1], refunds...",
  "sources": [
    {
      "source_name": "refund-policy.pdf",
      "relevance_score": 0.91
    }
  ],
  "chunks_used": 4,
  "model": "gpt-4o",
  "latency_ms": 1240
}
```

---

## Adding Connectors (Next Steps)

Each connector lives in `backend/connectors/`. To add Notion:

```python
# backend/connectors/notion.py
def fetch_notion_pages(token, database_id) -> List[Dict]:
    # 1. Call Notion API
    # 2. Extract text from pages
    # 3. Return list of {"text": ..., "source_name": ..., "source_id": ...}
    ...
```

Then call `chunk_document()` and `vector_store.upsert_chunks()` on the result — same pipeline, different input source.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite |
| Backend | Python + FastAPI |
| Embeddings | OpenAI text-embedding-3-small |
| Vector DB | Pinecone (serverless) |
| LLM | GPT-4o |
| Document parsing | pypdf, python-docx |

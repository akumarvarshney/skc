"""
Semantic Knowledge Copilot — Backend
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.ingest import router as ingest_router
from api.query import router as query_router
from api.connectors.notion_router import router as notion_router
from api.connectors.gdrive_router import router as gdrive_router
from api.connectors.slack_router import router as slack_router
from api.namespaces import router as namespace_router
from api.auth import router as auth_router
from api.chat_history import router as history_router
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

app = FastAPI(
    title="Semantic Knowledge Copilot",
    description="Ask questions. Get answers grounded in your company's knowledge.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "https://skc-rosy.vercel.app",
    "http://localhost:5173"
],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router)
app.include_router(query_router)
app.include_router(notion_router)
app.include_router(gdrive_router)
app.include_router(slack_router, prefix="/connectors/slack", tags=["Slack"])
app.include_router(namespace_router)
app.include_router(auth_router, prefix="/auth", tags=["Auth"])
app.include_router(history_router, prefix="/history", tags=["Chat History"])


@app.get("/")
def root():
    return {
        "name": "Semantic Knowledge Copilot",
        "version": "1.0.0",
        "docs": "/docs",
        "endpoints": {
            "upload": "POST /ingest/upload",
            "sources": "GET /ingest/sources",
            "delete": "DELETE /ingest/sources/{source_id}",
            "query": "POST /query",
            "health": "GET /query/health",
        }
    }

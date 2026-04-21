from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    gemini_api_key: str = ""
    pinecone_api_key: str = ""
    pinecone_index_name: str = "skc-knowledge"
    slack_bot_token: str = ""
    environment: str = "development"
    jwt_secret: str = "change-me"
    auth_username: str = "admin"
    auth_password_hash: str = ""
    max_file_size_mb: int = 20

    # Embedding model (Gemini)
    embedding_model: str = "models/gemini-embedding-001"
    embedding_dimensions: int = 3072

    # LLM
    llm_model: str = "llama-3.3-70b-versatile"
    llm_temperature: float = 0.1
    max_tokens: int = 1000

    # Groq
    groq_api_key: str = ""

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # Chunking
    chunk_size: int = 800
    chunk_overlap: int = 100

    # Retrieval
    top_k: int = 6

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()
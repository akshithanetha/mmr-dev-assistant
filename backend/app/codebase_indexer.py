import os
import chromadb
from pathlib import Path
from chromadb.utils import embedding_functions

# Directories to always skip
SKIP_DIRS = {
    '.git', 'node_modules', 'tmp', 'log', 'coverage',
    'vendor', '.bundle', 'public', 'storage'
}

# Priority dirs
PRIORITY_DIRS = {'app/models', 'app/controllers', 'app/services'}

# Initialize ChromaDB client
CHROMA_DB_PATH = os.environ.get("CHROMA_DB_PATH", "./chroma_db")
chroma_client = chromadb.PersistentClient(path=CHROMA_DB_PATH)

# Use Ollama for embeddings
ollama_ef = embedding_functions.OllamaEmbeddingFunction(
    url="http://localhost:11434/api/embeddings",
    model_name="nomic-embed-text"
)

collection = chroma_client.get_or_create_collection(
    name="mmr_codebase",
    embedding_function=ollama_ef
)

def chunk_text(text: str, chunk_size: int = 1500, overlap: int = 200) -> list[str]:
    chunks = []
    start = 0
    text_len = len(text)
    while start < text_len:
        end = min(start + chunk_size, text_len)
        if end < text_len:
            newline_pos = text.rfind('\n', start, end)
            if newline_pos != -1 and newline_pos > start + chunk_size // 2:
                end = newline_pos + 1
        chunks.append(text[start:end])
        start = end - overlap
        if start < 0:
            start = 0
        if end >= text_len:
            break
    return chunks

def index_workspace(workspace_root: str):
    """Walk the workspace and index all Ruby files into ChromaDB."""
    if not workspace_root:
        return

    # Check if we already have items to avoid re-indexing
    # For a real extension, we would use file modification times.
    if collection.count() > 0:
        return

    root = Path(workspace_root)
    if not root.exists():
        return

    docs = []
    metadatas = []
    ids = []

    for ruby_file in root.rglob('*.rb'):
        parts = set(ruby_file.relative_to(root).parts)
        if parts & SKIP_DIRS:
            continue

        rel_path = str(ruby_file.relative_to(root)).replace('\\', '/')
        try:
            content = ruby_file.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue

        is_priority = any(rel_path.startswith(p) for p in PRIORITY_DIRS)

        chunks = chunk_text(content)
        for i, chunk in enumerate(chunks):
            chunk_id = f"{rel_path}_{i}"
            docs.append(f"File: {rel_path}\n\n{chunk}")
            metadatas.append({"file": rel_path, "is_priority": is_priority})
            ids.append(chunk_id)

    # Insert into ChromaDB in batches
    batch_size = 50
    for i in range(0, len(docs), batch_size):
        collection.add(
            documents=docs[i:i+batch_size],
            metadatas=metadatas[i:i+batch_size],
            ids=ids[i:i+batch_size]
        )

def query_codebase(query: str, workspace_root: str, n_results: int = 5) -> list[dict]:
    """Query the codebase for relevant chunks."""
    index_workspace(workspace_root)

    if collection.count() == 0:
        return []

    results = collection.query(
        query_texts=[query],
        n_results=n_results
    )

    formatted_results = []
    if results and results.get('documents') and len(results['documents']) > 0:
        docs = results['documents'][0]
        metas = results['metadatas'][0]
        for idx in range(len(docs)):
            formatted_results.append({
                "content": docs[idx],
                "file": metas[idx]["file"] if metas[idx] else "unknown"
            })

    return formatted_results

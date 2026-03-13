from pathlib import Path
from app.codebase_indexer import query_codebase, SKIP_DIRS

def build_summary(workspace_root: str) -> str:
    """Build a compact project summary string of file paths."""
    root = Path(workspace_root)
    if not root.exists():
        return ""

    paths = []
    for ruby_file in root.rglob('*.rb'):
        parts = set(ruby_file.relative_to(root).parts)
        if parts & SKIP_DIRS:
            continue
        rel_posix = str(ruby_file.relative_to(root)).replace('\\', '/')
        paths.append(rel_posix)

    paths.sort()
    lines = ['## MMR-API Workspace Files\n', 'The following `.rb` files exist in the project:']
    for p in paths:
        lines.append(f"- {p}")
    return '\n'.join(lines)

def build_context_block(query: str, workspace_root: str) -> str:
    """
    Main entry point called by prompts.
    Returns a full context block string to prepend to any prompt.
    """
    if not workspace_root:
        return ""

    summary = build_summary(workspace_root)
    relevant = query_codebase(query, workspace_root, n_results=6)

    lines = [summary]
    if relevant:
        lines.append('\n## Relevant Code Snippets\n')
        lines.append('These snippets were retrieved using semantic search and are actual chunks from the codebase.')
        lines.append('Use ONLY these real file paths — do NOT invent new file names.\n')

        for item in relevant:
            lines.append(f'### Snippet from `{item["file"]}`')
            lines.append(f'```ruby\n{item["content"]}\n```')
            lines.append('')

    lines.append('---')
    lines.append('**IMPORTANT:** Only reference files listed above. Never create files that do not exist in this project structure.')
    lines.append('')
    return '\n'.join(lines)

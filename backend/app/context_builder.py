import re
from pathlib import Path
from typing import Optional
from app.codebase_indexer import index_workspace, build_summary, build_alias_map

# Max chars of file content to inject per relevant file
MAX_FILE_CHARS = 2000
# Max number of relevant files to inject
MAX_RELEVANT_FILES = 6


def _tokenize(text: str) -> set[str]:
    """Extract meaningful tokens from a query string."""
    text = text.lower()
    # Split on non-alphanumeric
    tokens = set(re.findall(r'[a-z][a-z0-9_]*', text))
    # Remove very short or generic tokens
    stopwords = {
        'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are',
        'was', 'add', 'new', 'use', 'all', 'get', 'set', 'run', 'its',
        'can', 'has', 'not', 'but', 'via', 'per', 'any'
    }
    return tokens - stopwords


def _score_file(rel_path: str, meta: dict, tokens: set[str], alias_map: dict) -> float:
    """Score how relevant a file is to the query tokens."""
    score = 0.0
    path_lower = rel_path.lower()
    stem = Path(rel_path).stem.lower()
    defs = meta.get('definitions', {})

    for token in tokens:
        # Direct path/stem match — highest weight
        if token in path_lower:
            score += 3.0
        if token in stem:
            score += 2.0

        # Alias map match (e.g. 'care_team' -> member_program_care_extender)
        if token in alias_map and alias_map[token] == rel_path:
            score += 5.0

        # Class/module name match
        for cls in defs.get('classes', []):
            cls_snake = re.sub(r'(?<!^)(?=[A-Z])', '_', cls['name']).lower()
            if token in cls_snake or token in cls['name'].lower():
                score += 2.5

        for mod in defs.get('modules', []):
            if token in mod.lower():
                score += 1.5

        # Association match
        for assoc_type in ('belongs_to', 'has_many', 'has_one'):
            for assoc in defs.get(assoc_type, []):
                if token in assoc.lower():
                    score += 1.5

        # Method name match
        for method in defs.get('methods', []):
            if token in method.lower():
                score += 0.8

        # Include match (concerns)
        for inc in defs.get('includes', []):
            if token in inc.lower():
                score += 1.0

    # Boost priority files slightly
    if meta.get('is_priority'):
        score *= 1.2

    return score


def find_relevant_files(query: str, index: dict, alias_map: dict, top_n: int = MAX_RELEVANT_FILES) -> list[dict]:
    """Return top-N most relevant files for the query."""
    tokens = _tokenize(query)
    if not tokens:
        return []

    scored = []
    for rel_path, meta in index.items():
        score = _score_file(rel_path, meta, tokens, alias_map)
        if score > 0:
            scored.append((score, rel_path, meta))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [{'path': path, 'score': score, 'meta': meta}
            for score, path, meta in scored[:top_n]]


def build_context_block(query: str, workspace_root: str) -> str:
    """
    Main entry point called by prompts.
    Returns a full context block string to prepend to any prompt.
    """
    index = index_workspace(workspace_root)
    alias_map = build_alias_map(index)
    summary = build_summary(index)
    relevant = find_relevant_files(query, index, alias_map)

    lines = [summary]

    if relevant:
        lines.append('\n## Relevant Files for This Query\n')
        lines.append('These are the ACTUAL files from the codebase most relevant to this request.')
        lines.append('Use ONLY these real file paths — do NOT invent new file names.\n')

        for item in relevant:
            path = item['path']
            meta = item['meta']
            defs = meta['definitions']
            classes = [c['name'] for c in defs['classes']]

            lines.append(f'### `{path}`')
            if classes:
                lines.append(f'**Classes:** {", ".join(classes)}')

            # Inject actual content if available
            content = meta.get('content')
            if content:
                snippet = content[:MAX_FILE_CHARS]
                if len(content) > MAX_FILE_CHARS:
                    snippet += '\n... (truncated)'
                lines.append(f'```ruby\n{snippet}\n```')
            else:
                # For non-priority files, at least show their definitions
                summary_parts = []
                for k in ('belongs_to', 'has_many', 'has_one', 'includes', 'scopes'):
                    vals = defs.get(k, [])
                    if vals:
                        summary_parts.append(f'{k}: {", ".join(vals)}')
                if summary_parts:
                    lines.append('  ' + ' | '.join(summary_parts))
            lines.append('')

    lines.append('---')
    lines.append('**IMPORTANT:** Only reference files listed above. Never create files that do not exist in this project structure.')
    lines.append('')

    return '\n'.join(lines)

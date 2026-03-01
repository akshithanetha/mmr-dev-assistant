import os
import re
from pathlib import Path
from typing import Optional

# Directories to always skip
SKIP_DIRS = {
    '.git', 'node_modules', 'tmp', 'log', 'coverage',
    'vendor', '.bundle', 'public', 'storage'
}

# Priority dirs for deep indexing (full content read)
PRIORITY_DIRS = {'app/models', 'app/controllers', 'app/services'}


def extract_ruby_definitions(content: str) -> dict:
    """Extract class, module, concern names and their parent classes from Ruby file."""
    definitions = {
        'classes': [],
        'modules': [],
        'concerns': [],
        'includes': [],
        'belongs_to': [],
        'has_many': [],
        'has_one': [],
        'scopes': [],
        'methods': [],
    }

    for line in content.splitlines():
        line = line.strip()

        m = re.match(r'^class\s+(\w+)(?:\s*<\s*(\S+))?', line)
        if m:
            definitions['classes'].append({
                'name': m.group(1),
                'parent': m.group(2) or ''
            })

        m = re.match(r'^module\s+(\w+)', line)
        if m:
            definitions['modules'].append(m.group(1))

        m = re.match(r'^include\s+(\S+)', line)
        if m:
            definitions['includes'].append(m.group(1))

        m = re.match(r'belongs_to\s+:(\w+)', line)
        if m:
            definitions['belongs_to'].append(m.group(1))

        m = re.match(r'has_many\s+:(\w+)', line)
        if m:
            definitions['has_many'].append(m.group(1))

        m = re.match(r'has_one\s+:(\w+)', line)
        if m:
            definitions['has_one'].append(m.group(1))

        m = re.match(r'scope\s+:(\w+)', line)
        if m:
            definitions['scopes'].append(m.group(1))

        m = re.match(r'def\s+(\w+)', line)
        if m:
            definitions['methods'].append(m.group(1))

    return definitions


def build_alias_map(index: dict) -> dict:
    """
    Build a map of common terms -> actual file paths.
    e.g. 'care_team' -> 'app/models/member_program_care_extender.rb'
    This helps the LLM understand domain aliases.
    """
    alias_map = {}

    for rel_path, meta in index.items():
        # Map class names to file paths
        for cls in meta.get('definitions', {}).get('classes', []):
            name = cls['name']
            # snake_case version
            snake = re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()
            alias_map[snake] = rel_path
            alias_map[name.lower()] = rel_path

        # Map the file stem itself
        stem = Path(rel_path).stem
        alias_map[stem] = rel_path

    return alias_map


def index_workspace(workspace_root: str) -> dict:
    """
    Walk the workspace and index all Ruby files.
    Returns a dict of { relative_path -> metadata }
    """
    root = Path(workspace_root)
    index = {}

    for ruby_file in root.rglob('*.rb'):
        # Skip unwanted dirs
        parts = set(ruby_file.relative_to(root).parts)
        if parts & SKIP_DIRS:
            continue

        rel_path = str(ruby_file.relative_to(root))

        try:
            content = ruby_file.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue

        rel_posix = rel_path.replace('\\', '/')
        is_priority = any(rel_posix.startswith(p) for p in PRIORITY_DIRS)

        definitions = extract_ruby_definitions(content)

        index[rel_posix] = {
            'path': rel_posix,
            'size': len(content),
            'lines': content.count('\n'),
            'definitions': definitions,
            # Only store full content for priority dirs to keep memory reasonable
            'content': content if is_priority else None,
            'is_priority': is_priority,
        }

    return index


def build_summary(index: dict) -> str:
    """
    Build a compact project summary string to always include in prompts.
    Lists every file with its class name and key associations.
    """
    lines = ['## MMR-API Project Structure\n']

    # Group by top-level dir
    groups: dict[str, list] = {}
    for rel_path, meta in sorted(index.items()):
        top = rel_path.split('/')[0] if '/' in rel_path else 'root'
        groups.setdefault(top, []).append((rel_path, meta))

    for group, files in sorted(groups.items()):
        lines.append(f'### {group}/')
        for rel_path, meta in files:
            defs = meta['definitions']
            classes = [c['name'] for c in defs['classes']]
            modules = defs['modules']
            label = ', '.join(classes + modules) or Path(rel_path).stem
            associations = []
            if defs['belongs_to']:
                associations.append('belongs_to: ' + ', '.join(defs['belongs_to']))
            if defs['has_many']:
                associations.append('has_many: ' + ', '.join(defs['has_many']))
            assoc_str = ' | ' + ' | '.join(associations) if associations else ''
            lines.append(f'  - `{rel_path}` → {label}{assoc_str}')
        lines.append('')

    return '\n'.join(lines)

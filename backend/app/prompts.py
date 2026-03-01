from app.context_builder import build_context_block

def _context(query: str, workspace_root: str) -> str:
    """Get the codebase context block. Returns empty string if no workspace."""
    if not workspace_root:
        return ''
    try:
        return build_context_block(query, workspace_root)
    except Exception as e:
        return f'<!-- Codebase indexing failed: {e} -->\n'


def feature_prompt(text: str, workspace_root: str = '') -> str:
    ctx = _context(text, workspace_root)
    return f"""{ctx}
You are a senior software architect working on the MMR Rails API project above.

Analyze the following feature story:

{text}

Using ONLY the actual files from the project structure above, respond with:

### Summary
A concise explanation of what this feature does and why it matters.

### Affected Files
List the REAL files from the project that need to be created or modified.
For each file, explain what change is needed.
DO NOT invent new files — only reference files shown in the project structure above.
If a new file is genuinely required, explain why no existing file can serve the purpose.

### Story Points Estimate
A single number: 0, 1, 2, 3, 5, or 8.
Justify in 1-2 sentences.

### Clarification Questions for the PM
3-5 specific questions the team should ask before starting.
"""


def refactor_prompt(text: str, workspace_root: str = '') -> str:
    ctx = _context(text, workspace_root)
    return f"""{ctx}
You are a senior Rails developer focused on clean, maintainable code in the MMR API project.

Refactor the following code:

```ruby
{text}
```

Using the project context above for consistency with existing patterns, provide:

### Refactored Code
The full refactored version in a code block.

### What Changed and Why
Each meaningful change and the reasoning behind it.

### Improvements Made
Specific improvements in readability, performance, or design patterns.

### Potential Risks
Anything the developer should verify or test after applying these changes.
"""


def explain_prompt(text: str, workspace_root: str = '') -> str:
    ctx = _context(text, workspace_root)
    return f"""{ctx}
You are an expert Rails engineer explaining code from the MMR API project.

Explain the following code:

```
{text}
```

### What It Does
Plain-English summary (2-3 sentences).

### Step-by-Step Breakdown
Walk through the code block by block.

### Key Concepts Used
Patterns, libraries, or language features used, with references to similar patterns in the project if visible above.

### Edge Cases & Potential Issues
Anything that could break or should be handled more carefully.
"""


def general_prompt(text: str, workspace_root: str = '') -> str:
    ctx = _context(text, workspace_root)
    return f"""{ctx}
You are a senior software architect and developer assistant for the MMR Rails API project.

The user asked: {text}

Answer using the actual project structure and files shown above where relevant.
Use markdown. Wrap code in triple backticks with the language identifier.
Only reference real files from the project — never invent file paths.
"""


def apply_changes_prompt(story: str, analysis: str, workspace_root: str = '') -> str:
    ctx = _context(story, workspace_root)
    return f"""{ctx}
You are a senior Rails developer implementing a feature in the MMR API project.

Feature story:
{story}

Analysis:
{analysis}

Return ONLY a valid JSON array — no explanation, no markdown, no backticks around the JSON.
Each object must have:
- "file": a REAL relative path from the project structure above (e.g. "app/models/member_program_care_extender.rb")
- "content": the full updated file content as a string

Only include files that exist in the project structure above, or new files that are genuinely necessary.
DO NOT create files like app/models/care_team.rb if member_program_care_extender.rb already handles that domain.

Example: [{{"file": "app/models/member_program_care_extender.rb", "content": "class MemberProgramCareExtender...\\nend"}}]
"""


def generate_tests_prompt(story: str, analysis: str, workspace_root: str = '') -> str:
    ctx = _context(story, workspace_root)
    return f"""{ctx}
You are a senior Rails developer writing RSpec tests for the MMR API project.

Feature story:
{story}

Implementation context:
{analysis}

Return ONLY a valid JSON array — no explanation, no markdown, no backticks around the JSON.
Each object must have:
- "file": path under spec/ mirroring the real source file (e.g. "spec/models/member_program_care_extender_spec.rb")
- "content": the full RSpec file content as a string

Cover: model validations, service logic, controller actions, and edge cases where relevant.
Use the actual class names from the project structure above.
"""

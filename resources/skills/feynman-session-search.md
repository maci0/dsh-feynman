---
name: feynman-session-search
description: Search saved DSH transcripts to recover previous research and artifact paths.
---

Search transcripts with rg over ~/.dsh/sessions/ or the host’s configured session directory. DSH records append-only session events, including user/message, assistant/message, and tool/result; inspect the actual JSONL schema before extracting fields. Recover source URLs, verification state, and artifact paths rather than treating an old summary as current evidence. Resume through DSH’s session controls. `/feynman search` browses current-session web results, not previous sessions.

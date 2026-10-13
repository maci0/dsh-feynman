# Releases

## v0.22.0

Research parity with upstream Feynman v0.5.41 within DeepSeek Harness.

- Add real scholarly clients for eight literature databases, Hugging Face metadata/file tools, and Alpha Hub OAuth research tools with sign-in/status/logout and annotations.
- Add isolated document parsing, phrase search and screenshots with the upstream-pinned parser, cancellation, bounded output, DSH image attachments and DOCX paragraph fallback.
- Ship all 16 research skills, four role protocols, a model-facing workflow loader, stored-web-result browsing and source-selection mode.
- Expand workflows to the current upstream evidence/artifact contracts. Deep research continues after planning unless plan review is explicitly requested. Add source-on-disk summarization with validated window controls and durable coverage notes.
- Remove retired rank, paper, watch, jobs, preview, feynman-model and web-results commands. Search now browses current-session web results; previous-session search moves to the transcript-search skill/host controls. Existing artifacts are preserved.
- Resolve credentials per call, redact values from evidence/errors, forward retrieval cancellation, confine document/OCR-data paths to the workspace and dispose native workers and tool registrations on unload.

Upgrade requires DSH `>=0.2.1-alpha.2 <0.3.0`, Node `^22.22.0 || >=24.0.0`, a DSH restart and browser refresh. AlphaXiv uses OAuth through `/feynman alpha login`; a legacy API key does not authenticate it. Provider, terminal and general session controls remain DSH-owned.

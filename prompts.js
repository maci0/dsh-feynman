/**
 * Pure Feynman workflow catalog: slash-command metadata and the agent prompts
 * each command steers with. No DeepSeek Harness imports here, so this module
 * is unit-testable with plain node.
 *
 * Source of truth for behavior: https://www.feynman.is/docs (workflows, agents,
 * tools, slash-commands, cli-commands references).
 */

/** Slugify a topic for `outputs/` artifact names. */
export function slugify(text) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return slug || 'untitled'
}

/** Split `/review-loop <target> [rounds]` trailing round count. */
export function parseLoopArgs(rawInput) {
  const input = rawInput.trim()
  if (!input) return { target: '', rounds: 3 }
  const parts = input.split(/\s+/)
  const last = parts[parts.length - 1]
  const n = Number(last)
  if (parts.length > 1 && Number.isInteger(n) && n >= 1 && n <= 10) {
    return { target: parts.slice(0, -1).join(' '), rounds: n }
  }
  return { target: input, rounds: 3 }
}

const TOOL_PRELUDE = `You are a research agent. Your retrieval tools are web_search and web_fetch, plus workspace tools (read, grep, glob, bash) for local files, cloned repos, and code. Route each source to its sanctioned API: arXiv papers via the export.arxiv.org API and arxiv.org/abs pages; paper metadata, citations, and references via the OpenAlex API (api.openalex.org); biomedical papers via Europe PMC; datasets, models, and repo files via the Hugging Face Hub API (huggingface.co/api, read-only). For broad multi-angle work, fan out with the subagent tool (one description + prompt per angle) and synthesize the returns; keep narrow explainers lead-owned to avoid needless orchestration.`
const KEY_PRELUDE = (hfTokenEnv, alphaxivTokenEnv) => `Credentials: the Hugging Face key lives in ${hfTokenEnv} and the AlphaXiv key in ${alphaxivTokenEnv} when set (ask /keys, or the human exports them before launch). Treat an unset key as blocked for the calls that need it — gated Hugging Face datasets read as blocked, and without AlphaXiv fall back to arXiv + OpenAlex. Never bypass paywalls. If a source is unreachable, mark that check blocked in the output — never invent or infer its content.`

const DEEPRESEARCH_PROMPT = (topic) => `${TOOL_PRELUDE}

Workflow: deep research on "${topic}".
1. Write a plan to outputs/.plans/${slugify(topic)}.md (key questions, source strategy, scale decision, task ledger) and continue into execution without waiting for confirmation.
2. Gather: diversified queries across papers, web sources, docs, and code. Prefer metadata/abstracts/HTML/official docs over PDF extraction.
3. Extract claims, methods, results, limitations per source, tagged with source locations.
4. Synthesize into a research brief at outputs/${slugify(topic)}-brief.md with inline citations: Summary, Background, Key Findings (by theme), Open Questions, References.
5. Verify claims against cited sources; flag misattributions or unsupported assertions. Record verification caveats in the brief.`

const LIT_PROMPT = (topic) => `${TOOL_PRELUDE}

Workflow: structured literature review on "${topic}". If the input names a lab, PI, author, or lab website, switch to publication-corpus mode (resolve identity, log reachable publications, map topic trajectories, rank 3-5 papers by contrastive originality).
1. Search broadly (surveys, foundational work, recent frontier). Note search terms, time window, source types.
2. Extract claims, results, methodology per paper.
3. Write outputs/${slugify(topic)}-lit-review.md: Scope and Methodology, Consensus (with citations), Disagreements, Open Questions, Timeline, References. For biomedical topics, group evidence by study design (guidelines, systematic reviews, RCTs, cohorts, case reports, preprints, mechanistic), report effect sizes only when source-backed, and state that the output is research synthesis, not medical advice.`

const REVIEW_PROMPT = (artifact) => `${TOOL_PRELUDE}

Workflow: internal research review of "${artifact}" (arXiv ID, URL, or local file; fetch or read it first). This is a pre-trust critique, not a publication decision.
1. Record evidence notes as you go.
2. Evaluate: claims vs evidence, methodology soundness and confounds, experimental design (baselines, ablations), reproducibility, writing clarity, completeness (limitations, related work).
3. Write exactly one final review to outputs/${slugify(artifact)}-review.md with severity-graded findings — critical (undermines validity), major (should fix), minor (suggestion), nit (style) — each with a confidence score: Summary Assessment (revision priority), Strengths, Critical Issues, Major Issues, Minor Issues, Inline Annotations tied to document sections. Flag unverifiable claims as needing evidence. If the artifact cannot be parsed, still write the review and mark affected checks blocked.`

const AUDIT_PROMPT = (item) => `${TOOL_PRELUDE}

Workflow: code audit of "${item}" (arXiv ID or repo URL plus --paper ID; when given only an arXiv ID, find the repo through links on the arxiv.org/abs page).
Pass 1 (researcher): extract concrete claims from the paper — hyperparameters, architecture, training procedure, dataset splits, metrics, reported results — each tagged with its paper location.
Pass 2 (verifier): find each claim's implementation (configs, training scripts, model definitions, eval code). Document mismatches with paper location plus exact file paths and line numbers; list claims with no corresponding code.
Also flag reproducibility risks: missing seeds, unpinned deps, hardcoded paths, missing environment specs.
Write outputs/${slugify(item)}-audit.md: Match Summary (% claims matched), Confirmed Claims, Mismatches, Missing Implementations, Reproducibility Risks.`

const REPLICATE_PROMPT = (target) => `${TOOL_PRELUDE}

Workflow: replication plan for "${target}" (paper or specific claim). Plan only: do NOT execute anything until the user chooses an environment (local, container, cloud, or plan-only).
1. Extract stated details: architecture, hyperparameters, schedule, data prep, eval protocol, hardware. Cross-reference linked/supplied code.
2. For ML-heavy targets add a recipe pass linking each claimed result to dataset, method, hyperparameters, compute, metric, and code path (verify Hugging Face dataset schema/splits via the huggingface.co/api dataset endpoints when relevant).
3. Write outputs/${slugify(target)}-replication-plan.md: Requirements (hardware/software/data/compute estimate), Recipe Extraction, Step-by-step Plan, Underspecified Details (gap + assumption + divergence risk each), Risk Assessment, Success Criteria (what counts as replicated).`

const RECIPE_PROMPT = (task) => `${TOOL_PRELUDE}

Workflow: ML training recipe for "${task}".
1. Gather candidates from papers, docs, repos, and Hugging Face Hub metadata (dataset features/splits, repo files, configs — read-only via the huggingface.co/api endpoints; HF_TOKEN may be present for gated resources).
2. Link each reported result to the recipe that produced it: dataset (+split/schema), method, hyperparameters, compute, benchmark, code path, verification status. A paper without usable data/code/config detail is a risk, not a runnable recipe. Label checks verified / unverified / blocked / inferred; never call a recipe state-of-the-art, replicated, or production-ready without supporting checks.
3. Write outputs/${slugify(task)}-recipe.md: Recommendation (one recipe first + why), Ranked Recipe Table, Dataset Notes, Implementation Plan (minimal steps), Known Gaps, Sources (every URL).`

const COMPARE_PROMPT = (input) => `${TOOL_PRELUDE}

Workflow: source comparison for "${input}" (topic — find the most relevant contrasting sources — or explicit paper IDs/files — use directly).
1. Analyze each source independently: claims, results, methodology, limitations.
2. Align claims across sources: agreement, genuine disagreement, non-overlapping scope. Note when apparent disagreement may come from different protocols rather than conflicting results.
3. Write outputs/${slugify(input)}-compare.md: Source Summaries (one paragraph each), Agreement Matrix, Disagreement Matrix (with divergence analysis), Methodology Differences, Synthesis (well-supported vs contested).`

const DRAFT_PROMPT = (input) => `${TOOL_PRELUDE}

Workflow: academic draft on "${input}". If the input is --from-session, skip research and write from this session's vetted findings; otherwise gather sources first.
Write outputs/${slugify(input)}-draft.md following academic structure: Abstract, Introduction (motivation, context, contributions), Body Sections, Discussion, Limitations (honest), References (only works cited, consistent format). Inline-cite factual claims; mark anything unsupported as an explicit TODO/gap — never invent results, figures, tables, or benchmark numbers.`

const AUTORESEARCH_PROMPT = (idea) => `${TOOL_PRELUDE}

Workflow: bounded autoresearch experiment loop for "${idea}".
1. Confirm with the user first if any of these are missing: benchmark, metric, environment, files in scope, iteration limit.
2. Loop: Hypothesis → Experiment → Analysis → Decision (keep / vary / pivot). Log every iteration (params, results) to autoresearch.md + autoresearch.jsonl in the workspace; never repeat a failed approach.
3. Report: Experiment History, Best Configuration, Ablation Results, Recommendations. This is for hypothesis/benchmark-driven search (prompts, hyperparams, retrieval, architectures), not open-ended Q&A.`

const WATCH_PROMPT = (topic) => `${TOOL_PRELUDE}

Workflow: research watch on "${topic}".
1. Write the watch plan (topic, monitored signals, meaningful-change criteria, check frequency) to outputs/.plans/${slugify(topic)}-watch.md.
2. Run a baseline sweep (papers, articles, docs, releases, code) and save outputs/${slugify(topic)}-baseline.md: New Papers, New Articles, Relevance Notes.
3. Schedule follow-ups ONLY with the schedule_create tool when it is visible in this session; otherwise mark scheduling blocked and include the exact refresh prompt to run later.`

const RANK_PROMPT = (topic) => `${TOOL_PRELUDE}

Workflow: read-first paper ranking for "${topic}". Scores are a transparent heuristic computed live in this session, not a fitted model — say so in the output.
1. Fetch candidates via the OpenAlex API (works, cites, references, abstracts, OA status).
2. Score each 0-100 on: topical relevance (30%), citation impact (20%), local graph prestige over referenced_works edges (20%, excluded when no local edges exist), citation velocity (10%), methodology screening (10%), reproducibility screening (10%).
3. Write outputs/${slugify(topic)}-paper-rank.md (ranked brief with per-paper score math and evidence spans) plus a sensitivity note (which papers are stable vs volatile under alternate weightings). Keep bibliometric influence separate from quality judgments; record unverified checks as gaps, not scores.`

const PAPER_PROMPT = (id) => `${TOOL_PRELUDE}

Workflow: paper access resolution for "${id}" (DOI, PubMed ID, arXiv ID, or title).
Resolve access candidates via OpenAlex, DOI, PubMed/PMCID, arXiv, and Europe PMC; for a title, search OpenAlex first. Report candidates without bypassing paywalls. With --fetch-full-text, fetch text only through source-sanctioned APIs and write bounded artifacts (summary + access record), never raw full-text dumps.`

const PREVIEW_PROMPT = (target) => `${TOOL_PRELUDE}

Workflow: preview "${target || 'the most recent file under outputs/'}" (a Markdown, HTML, or PDF research artifact).
Render with pandoc via bash when it is installed (check first with \`pandoc --version\`): Markdown to HTML with math support, or to PDF for sharing. Open HTML directly — no conversion step. Report the rendered path and, for math-heavy documents, confirm inline ($...$), display ($$...$$), tables, and citations rendered correctly. When pandoc is unavailable, say so and give the exact install command for this machine instead of pretending a preview exists.`

/** Compose the full model brief: workflow prompt plus live key refs. */
export function buildPrompt(kind, args, refs = { hfTokenEnv: 'HF_TOKEN', alphaxivTokenEnv: 'ALPHAXIV_API_KEY' }) {
  return `${WORKFLOWS[kind].prompt(args)}\n\n${KEY_PRELUDE(refs.hfTokenEnv, refs.alphaxivTokenEnv)}`
}

/** All workflow commands: name → spec. `args` = trimmed rawInput or '' . */
export const WORKFLOWS = {
  deepresearch: {
    description: 'Thorough source-heavy investigation → research brief with inline citations',
    hint: '<topic>',
    required: true,
    prompt: DEEPRESEARCH_PROMPT,
  },
  lit: {
    description: 'Structured literature review: consensus, disagreements, open questions (or lab/PI corpus mode)',
    hint: '<topic-or-lab>',
    required: true,
    prompt: LIT_PROMPT,
  },
  review: {
    description: 'Internal research review with severity-graded feedback and inline annotations',
    hint: '<arXiv-ID | URL | file>',
    required: true,
    prompt: REVIEW_PROMPT,
  },
  'review-loop': {
    description: 'Bounded review→fix→re-review loop until findings shrink or rounds run out',
    hint: '<arXiv-ID | URL | file> [rounds=3] | stop',
    required: true,
    prompt: REVIEW_PROMPT,
  },
  audit: {
    description: "Compare a paper's claims against its codebase: mismatches + reproducibility risks",
    hint: '<arXiv-ID | repo-URL> [--paper <id>]',
    required: true,
    prompt: AUDIT_PROMPT,
  },
  replicate: {
    description: 'Source-backed replication plan (executes only after you pick an environment)',
    hint: '<paper | claim>',
    required: true,
    prompt: REPLICATE_PROMPT,
  },
  recipe: {
    description: 'Ranked implementable ML training recipes backed by papers, data, docs, code',
    hint: '<training-task>',
    required: true,
    prompt: RECIPE_PROMPT,
  },
  compare: {
    description: 'Side-by-side source comparison → agreement/disagreement matrix',
    hint: '<topic | paper-IDs>',
    required: true,
    prompt: COMPARE_PROMPT,
  },
  draft: {
    description: 'Paper-style draft from findings (--from-session reuses this session)',
    hint: '<topic | --from-session>',
    required: true,
    prompt: DRAFT_PROMPT,
  },
  autoresearch: {
    description: 'Bounded hypothesis→experiment→analysis→decision loop against a benchmark',
    hint: '<idea>',
    required: true,
    prompt: AUTORESEARCH_PROMPT,
  },
  watch: {
    description: 'Baseline survey + refresh plan for a fast-moving topic',
    hint: '<topic>',
    required: true,
    prompt: WATCH_PROMPT,
  },
  rank: {
    description: 'Rank papers read-first with transparent relevance/citation/method scoring',
    hint: '<topic>',
    required: true,
    prompt: RANK_PROMPT,
  },
  paper: {
    description: 'Resolve legal full-text access candidates for one paper',
    hint: '<DOI | PubMed-ID | arXiv-ID | title> [--fetch-full-text]',
    required: true,
    prompt: PAPER_PROMPT,
  },
  preview: {
    description: 'Render a research artifact (Markdown/HTML/PDF) via pandoc',
    hint: '[artifact-path]',
    required: false,
    prompt: PREVIEW_PROMPT,
  },
}

/** Session/utility command names and descriptions (handlers live in index.js). */
export const SESSION_COMMANDS = {
  log: 'Write a durable session log: completed work, findings, open questions, next steps',
  jobs: 'Inspect background-job state and durable watch/experiment artifacts',
  help: 'Show grouped research commands',
  'feynman-model': 'Show how to change the model route for this profile',
  init: 'Bootstrap AGENTS.md and session-log folders for a research project',
  outputs: 'Browse research artifacts under outputs/',
  btw: 'Ask a side question as non-waking context while the main turn runs',
  thinking: 'Note a thinking level (off, minimal, low, medium, high, xhigh, max) for upcoming requests',
  search: 'Search prior session transcripts for past research and findings',
  'web-results': 'List web sources fetched this session with result metadata',
  keys: 'Show or store research API keys (Hugging Face, AlphaXiv)',
}

/** Feynman's thinking levels, accepted by /thinking. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Prompt for one review-loop round after the first. */
// ponytail: fixed-round loop; add a findings-parser stop condition when early exit matters.
export function loopFollowupPrompt(target, round, remaining) {
  return `Review-loop round ${round} for "${target}" (${remaining} round(s) left after this one). Address the previous round's critical and major findings first using your tools, then re-review the updated state. Reply with: (1) what you changed or verified since last round, (2) the fresh severity-graded findings (critical/major/minor/nit), (3) whether the artifact is clean enough to stop early.`
}

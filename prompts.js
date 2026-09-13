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

/** Strip a leading `arxiv:` vendor prefix to the bare ID, so both spellings share slugs and API calls. */
export function stripArxivPrefix(text) {
  const stripped = text.replace(/^arxiv:\s*/i, '')
  return (stripped.trim() ? stripped : text).trim()
}

/** Strip every `arxiv:` prefix inside a mixed string (ID lists like `arxiv:1 arxiv:2`), keeping other words intact. */
export function stripArxivPrefixes(text) {
  return text.replace(/arxiv:\s*/gi, '').trim() || text.trim()
}

/** Split `/review-loop <target> [rounds]` trailing round count. */
export function parseLoopArgs(rawInput) {
  const match = /^(.*?)\s+(\d+)$/.exec(rawInput.trim())
  if (match) {
    const rounds = Number(match[2])
    if (rounds >= 1 && rounds <= 10) return { target: match[1], rounds }
  }
  const input = rawInput.trim()
  return { target: input, rounds: 3 }
}

const TOOL_PRELUDE = `You are a research agent. Your retrieval tools are web_search and web_fetch, plus workspace tools (read, grep, glob, bash) for local files, cloned repos, and code. Route each source to its sanctioned API: arXiv papers via the export.arxiv.org API and arxiv.org/abs pages; paper metadata, citations, and references via the OpenAlex API (api.openalex.org); biomedical papers via Europe PMC; datasets, models, and repo files via the Hugging Face Hub API (huggingface.co/api, read-only). Delegate by role when it helps: researcher (deepresearch, lit, review, audit, replicate, recipe, compare, draft) gathers, reviewer (review, audit, compare) runs the adversarial pass, writer (deepresearch, lit, draft, compare) produces the final document, verifier (deepresearch, audit, replicate, recipe) fact-checks. For broad multi-angle work, fan out with the subagent tool (one description + prompt per angle) and synthesize the returns; keep narrow explainers lead-owned to avoid needless orchestration.`
const KEY_PRELUDE = (hfTokenEnv, alphaxivTokenEnv) => `Credentials: the Hugging Face key lives in ${hfTokenEnv} (HUGGINGFACE_HUB_TOKEN accepted as fallback; send whichever is present) and the AlphaXiv key in ${alphaxivTokenEnv} when set (ask feynman keys, or the human exports them before launch). Spend the AlphaXiv key via web_fetch against the AlphaXiv API (alphaxiv.org Honk with Authorization bearer): paper search, paper content and section extraction (alpha_get_paper section/sections: abstract, introduction, methodology, experiments, results, discussion, limitations, conclusion), paper Q&A, linked-repo code inspection, annotations; without it fall back to arXiv + OpenAlex and mark citation-metadata/discussion-thread/source-text checks blocked. Treat an unset key as blocked for the calls that need it — gated Hugging Face datasets read as blocked. Never bypass paywalls. If a source is unreachable, mark that check blocked in the output — never invent or infer its content.`

const DEEPRESEARCH_PROMPT = (topic) => `${TOOL_PRELUDE}

Workflow: deep research on "${topic}".
1. Write a plan to outputs/.plans/${slugify(topic)}.md (key questions, source strategy, scale decision, task ledger, verification log), summarize it, and WAIT for the human to confirm or request changes before executing.
2. Gather: diversified queries across papers, web sources, docs, and code. Prefer metadata/abstracts/HTML/official docs over PDF extraction.
3. Extract claims, methods, results, limitations per source, tagged with source locations.
4. Synthesize into a research brief at outputs/${slugify(topic)}-brief.md with inline citations: Summary, Background, Key Findings (by theme), Open Questions, References. Record source accounting, formula, and verification caveats in outputs/${slugify(topic)}-brief.provenance.md.
5. Verify claims against cited sources; flag misattributions or unsupported assertions. Record verification caveats in the brief.`

const LIT_PROMPT = (topic) => `${TOOL_PRELUDE}

Workflow: structured literature review on "${topic}". If the input names a lab, PI, author, or lab website, switch to publication-corpus mode (resolve identity, write a reachable-publication log first, map topic trajectories, rank 3-5 papers by contrastive originality, methodology strength, and relationship to prior art).
1. Search broadly (surveys, foundational work, recent frontier). Note search terms, time window, source types.
2. Extract claims, results, methodology per paper.
3. Write outputs/${slugify(topic)}-lit-review.md: Scope and Methodology, Consensus (with citations), Disagreements, Open Questions, Timeline, References. For biomedical topics, frame the question as PICO/PICOS (population, intervention/exposure, comparator, outcomes, study design) or state the study type directly; group evidence by study design (guidelines, systematic reviews, RCTs, cohorts, case reports, preprints, mechanistic), report effect sizes only when source-backed; never ask for or paste protected health information — use de-identified or fictionalized questions; state that the output is research synthesis, not medical advice.`

const REVIEW_PROMPT = (rawArtifact) => {
  const artifact = stripArxivPrefix(rawArtifact)
  return `${TOOL_PRELUDE}

Workflow: internal research review of "${artifact}" (arXiv ID, URL, or local file; fetch or read it first). This is a pre-trust critique, not a publication decision.
0. Write a plan to outputs/.plans/${slugify(artifact)}-review-plan.md, then continue immediately into evidence gathering and the final review without waiting for confirmation.
1. Record evidence notes in outputs/.drafts/${slugify(artifact)}-review-evidence.md as you go.
2. Evaluate: claims vs evidence, methodology soundness and confounds, experimental design (baselines, ablations), reproducibility, writing clarity, completeness (limitations, related work).
3. Write exactly one final review to outputs/${slugify(artifact)}-review.md with severity-graded findings — critical (undermines validity), major (should fix), minor (suggestion), nit (style) — each with a confidence score: Summary Assessment (revision priority), Strengths, Critical Issues, Major Issues, Minor Issues, Inline Annotations tied to document sections. Flag unverifiable claims as needing evidence. If the artifact cannot be parsed, still write the review and mark affected checks blocked.`
}

const AUDIT_PROMPT = (rawItem) => {
  const item = stripArxivPrefix(rawItem)
  return `${TOOL_PRELUDE}

Workflow: code audit of "${item}" (arXiv ID or repo URL plus --paper ID; when given only an arXiv ID, find the repo through paper links, Papers With Code, or GitHub search).
Pass 1 (researcher): extract concrete claims from the paper — hyperparameters, architecture, training procedure, dataset splits, metrics, reported results — each tagged with its paper location.
Pass 2 (verifier): find each claim's implementation (configs, training scripts, model definitions, eval code). Document mismatches with paper location plus exact file paths and line numbers; list claims with no corresponding code.
Also flag reproducibility risks: missing seeds, unpinned deps, hardcoded paths, missing environment specs.
Write outputs/${slugify(item)}-audit.md: Match Summary (% claims matched), Confirmed Claims, Mismatches, Missing Implementations, Reproducibility Risks.`
}

const REPLICATE_PROMPT = (rawTarget) => {
  const target = stripArxivPrefix(rawTarget)
  return `${TOOL_PRELUDE}

Workflow: replication plan for "${target}" (paper or specific claim). Plan only: do NOT execute anything until the user chooses an environment (local, container, cloud, or plan-only).
1. Extract stated details: architecture, hyperparameters, schedule, data prep, eval protocol, hardware. Cross-reference linked/supplied code.
2. For ML-heavy targets add a recipe pass linking each claimed result to dataset, method, hyperparameters, compute, metric, and code path (verify Hugging Face dataset schema/splits via the huggingface.co/api dataset endpoints when relevant).
3. Write outputs/${slugify(target)}-replication-plan.md: Requirements (hardware/software/data/compute estimate), Recipe Extraction, Step-by-step Plan, Underspecified Details (gap + assumption + divergence risk each), Risk Assessment, Success Criteria (what counts as replicated). Label a result replicated only when the planned checks actually pass.`
}

const RECIPE_PROMPT = (task) => `${TOOL_PRELUDE}

Workflow: ML training recipe for "${task}".
0. Write a plan to outputs/.plans/${slugify(task)}-recipe.md, then continue automatically.
1. Gather candidates from papers, docs, repos, and Hugging Face Hub metadata (dataset features/splits, repo files, configs — read-only via the huggingface.co/api endpoints; HF_TOKEN may be present for gated resources).
2. Link each reported result to the recipe that produced it: dataset (+split/schema), method, hyperparameters, compute, benchmark, code path, verification status. A paper without usable data/code/config detail is a risk, not a runnable recipe. Label checks verified / unverified / blocked / inferred; never call a recipe state-of-the-art, replicated, or production-ready without supporting checks.
3. Write outputs/${slugify(task)}-recipe.md: Recommendation (one recipe first + why), Ranked Recipe Table, Dataset Notes, Implementation Plan (minimal steps), Known Gaps, Sources (every URL); plus outputs/${slugify(task)}-recipe.provenance.md with source accounting and verification caveats.`

const COMPARE_PROMPT = (rawInput) => {
  const input = stripArxivPrefixes(rawInput)
  return `${TOOL_PRELUDE}

Workflow: source comparison for "${input}" (topic — find the most relevant contrasting sources — or explicit paper IDs/files — use directly).
1. Analyze each source independently: claims, results, methodology, limitations.
2. Align claims across sources: agreement, genuine disagreement, non-overlapping scope. Note when apparent disagreement may come from different protocols rather than conflicting results.
3. Write outputs/${slugify(input)}-compare.md: Source Summaries (one paragraph each), Agreement Matrix, Disagreement Matrix (with divergence analysis), Methodology Differences, Synthesis (well-supported vs contested).`
}

const DRAFT_PROMPT = (rawInput) => {
  const input = stripArxivPrefixes(rawInput)
  return `${TOOL_PRELUDE}

Workflow: academic draft on "${input}". If the input is --from-session, skip research and write from this session's vetted findings; otherwise gather sources first.
Write outputs/${slugify(input)}-draft.md following academic structure: Abstract, Introduction (motivation, context, contributions), Body Sections, Discussion, Limitations (honest), References (only works cited, consistent format). Inline-cite factual claims; mark anything unsupported as an explicit TODO/gap — never invent results, figures, tables, or benchmark numbers.`
}

const AUTORESEARCH_PROMPT = (idea) => `${TOOL_PRELUDE}

Workflow: bounded autoresearch experiment loop for "${idea}".
1. Confirm with the user first if any of these are missing: benchmark, metric, environment, files in scope, iteration limit.
2. Loop: Hypothesis → Experiment → Analysis → Decision (keep / vary / pivot). Log every iteration (params, results) to autoresearch.md + autoresearch.jsonl in the workspace; record milestones in CHANGELOG.md; never repeat a failed approach.
3. Report: Experiment History, Best Configuration, Ablation Results, Recommendations. This is for hypothesis/benchmark-driven search (prompts, hyperparams, retrieval, architectures), not open-ended Q&A.`

const WATCH_PROMPT = (topic) => `${TOOL_PRELUDE}

Workflow: research watch on "${topic}".
1. Write the watch plan (topic, monitored signals, meaningful-change criteria, check frequency) to outputs/.plans/${slugify(topic)}-watch.md.
2. Run a baseline sweep (papers, articles, docs, releases, code) and save outputs/${slugify(topic)}-baseline.md: New Papers, New Articles, Relevance Notes.
3. Schedule follow-ups ONLY with the schedule_create tool when it is visible in this session; otherwise mark scheduling blocked and include the exact refresh prompt to run later. Each follow-up check compares against the baseline so genuinely new material is separable from old findings.`

/** Split `/rank <topic> [options]` flags. All upstream PaperRank flags are parsed; unknown --flags are rejected. */
export function parseRankArgs(rawInput) {
  const parts = rawInput.trim().split(/\s+/).filter(Boolean)
  const out = {
    topic: '', limit: 20, expandCitations: 0, fullTextTop: 0, critiqueTop: 0,
    preferenceFile: null, reproductionNotes: null, synthesize: false, synthesisTop: 7,
    synthesisModel: null, outputDir: 'outputs', json: false, unsupported: [],
  }
  const topicParts = []
  for (let i = 0; i < parts.length; i += 1) {
    const token = parts[i]
    const next = parts[i + 1]
    if (token === '--limit' && /^\d+$/.test(next ?? '')) { out.limit = Math.min(Math.max(Number(next), 1), 100); i += 1 }
    else if (token === '--expand-citations' && /^\d+$/.test(next ?? '')) { out.expandCitations = Math.min(Math.max(Number(next), 0), 5); i += 1 }
    else if (token === '--full-text-top' && /^\d+$/.test(next ?? '')) { out.fullTextTop = Math.max(Number(next), 0); i += 1 }
    else if (token === '--critique-top' && /^\d+$/.test(next ?? '')) { out.critiqueTop = Math.max(Number(next), 0); i += 1 }
    else if (token === '--preference-file' && next !== undefined && !next.startsWith('--')) { out.preferenceFile = next; i += 1 }
    else if (token === '--reproduction-notes' && next !== undefined && !next.startsWith('--')) { out.reproductionNotes = next; i += 1 }
    else if (token === '--synthesis-top' && /^\d+$/.test(next ?? '')) { out.synthesisTop = Math.max(Number(next), 1); i += 1 }
    else if ((token === '--synthesis-model' || token === '--model') && next !== undefined && !next.startsWith('--')) { out.synthesisModel = next; i += 1 }
    else if (token === '--output-dir' && next !== undefined && !next.startsWith('--')) { out.outputDir = next; i += 1 }
    else if (token === '--synthesize') { out.synthesize = true }
    else if (token === '--json') { out.json = true }
    else if (token.startsWith('--')) { out.unsupported.push(token) }
    else { topicParts.push(token) }
  }
  out.topic = topicParts.join(' ')
  return out
}

const RANK_PROMPT = ({ topic, limit = 20, expandCitations = 0, fullTextTop = 0, critiqueTop = 0, preferenceFile = null, reproductionNotes = null, synthesize = false, synthesisTop = 7, synthesisModel = null, outputDir = 'outputs', json = false }) => {
  const slug = slugify(topic)
  const dir = (outputDir || 'outputs').replace(/\/+$/, '')
  const selModel = synthesisModel ?? 'the recommended approved research model'
  return `${TOOL_PRELUDE}

Workflow: PaperRank read-first ranking for "${topic}". Scores are a transparent heuristic computed live in this session, not a fitted model — say so in the output.
1. Fetch up to ${limit} seed candidates via the OpenAlex API (works, cites, references, abstracts, URLs, OA status).${expandCitations > 0 ? ` Expand the citation neighborhood first: add up to ${expandCitations} outgoing cited works (referenced_works) and incoming citing works (cites:<work>) per seed before scoring graph prestige; expansion papers are graph context only — ranked outputs still score the seeds.` : ' Build the local graph from the seed result set only.'}
2. Score each seed 0-100 as a weighted average over available components (ReadFirstScore): topical relevance 30%, citation impact 20%, graph prestige 20% (PageRank-style over referenced_works edges; when the graph has no local citation edges mark prestige unavailable and exclude it instead of guessing), citation velocity 10% (separate — lifetime counts favor older papers), methodology quality 10%, reproducibility 10%. Methodology and reproducibility are deterministic screening signals over metadata, abstract text, URLs${fullTextTop > 0 ? ', and enriched full text' : ''}. Keep bibliometric influence separate from quality judgments; record unverified checks as gaps, not scores.
${fullTextTop > 0 ? `3. Full-text enrichment: fetch source-specific full text for the top ${fullTextTop} candidates with a fetchable access route, extract canonical paper sections, attach section-specific paper-body spans, answer checklist rubrics (present / partial / missing / not_evaluated for limitations, reproducibility path, experimental details, statistical significance, compute resources), and rescore. Never write raw full text to papers JSONL — store enrichment status, access candidates, fullTextLength, and section boundaries; score evidence keeps matched spans (source, field, marker, character offsets, section, surrounding text).\n` : ''}Write the default artifacts under ${dir}/ (topic slug ${slug}):
- ${slug}-research-run.json — typed run manifest: jobs, sources, papers, tools, artifacts, verification state, constraints, next actions (the machine-readable spine; attach follow-up work here, don't scrape report files).
- ${slug}-paper-rank.md — readable ranked brief.
- ${slug}-papers.jsonl — normalized paper records.
- ${slug}-scores.jsonl — component scores, evidence, matched source spans.
- ${slug}-score-audit.md — per-paper score math, normalized contribution weights, field roles, evidence gaps, source excerpts.
- ${slug}-rank-sensitivity.json — rerun the same signals under balanced, influence-heavy, method/reproducibility-heavy, frontier-heavy, and topic-heavy profiles (profile ranks, score range, rank range, stability label; stable = robust, volatile = inspect manually).
- ${slug}-citation-graph.json — seed/citation-neighborhood graph and PageRank-style values.
- ${slug}-graph-explorer.html — interactive explorer (search/filter seed and expanded nodes, local citation links, score summaries, field roles, critique judgments, source URLs; no raw full-text bodies).
- ${slug}-field-map.json — OpenAlex topic/concept clusters with roles foundation, frontier, bridge, methodology-anchor, reproducibility-anchor (local navigation labels, not a global taxonomy).
- ${slug}-rank.provenance.md — source accounting, formula, verification caveats.
${critiqueTop > 0 ? `Critique: write ${slug}-critique.md with deterministic research-critique strengths, concerns, and follow-up questions for the top ${critiqueTop} papers, grounded in PaperRank evidence (component scores, warnings, source spans, rubric answers) — a triage aid, not an external review decision.\n` : ''}${preferenceFile ? `Calibration: read ${preferenceFile} (rankedPaperIds + pairwise preferences), evaluate whether each preferred paper ranks ahead, report default/profile agreement rates, and write ${slug}-score-calibration.json, ${slug}-calibration-template.json, ${slug}-calibration-guide.md. IDs outside the run count as ignored, never silently dropped.\n` : 'Calibration: no preference file supplied — record that default weights are a transparent product hypothesis, not fitted preferences, and write no calibration files.\n'}${reproductionNotes ? `Reproduction: read ${reproductionNotes} (statuses reproduced / partially_reproduced / failed / not_runnable plus central claim, result, metric, expected/observed values, discrepancy, code/data/environment hints, commands, check date) and write ${slug}-reproduction-ledger.json, ${slug}-reproduction-notes-template.json, ${slug}-replication-plan.md. Notes outside the ranked seed set count as ignored. The ledger records externally supplied notes; it does not execute experiments or embed raw full text.\n` : 'Reproduction: no completed reproduction notes supplied — record that inside the brief and provenance, and write no reproduction files.\n'}${synthesize ? `Synthesis: write ${slug}-synthesis-packet.json and ${slug}-synthesis-prompt.md (ranks, score explanations, field roles, critique summaries, rubric gaps, span excerpts, references for the top ${synthesisTop} papers; omit raw full-text bodies), then ask ${selModel} to write ${slug}-model-synthesis.md from that packet. CLI output, synthesis, JSON summary, and provenance record the actual model plus whether it came from the recommendation path or an explicit override.\n` : ''}${json ? 'Also print a compact JSON summary after writing artifacts.\n' : ''}`
}

/** Split `/paper <id> [--fetch-full-text] [--json]` flags. Unknown --flags are rejected. */
export function parsePaperArgs(rawInput) {
  const parts = rawInput.trim().split(/\s+/).filter(Boolean)
  const out = { id: '', fetchFullText: false, json: false, unsupported: [] }
  const idParts = []
  for (const token of parts) {
    if (token === '--fetch-full-text') out.fetchFullText = true
    else if (token === '--json') out.json = true
    else if (token.startsWith('--')) out.unsupported.push(token)
    else idParts.push(token)
  }
  out.id = idParts.join(' ')
  return out
}

const PAPER_PROMPT = ({ id: rawId, fetchFullText = false, json = false }) => {
  const id = stripArxivPrefix(rawId)
  return `${TOOL_PRELUDE}

Workflow: paper access resolution for "${id}" (DOI, PubMed ID, arXiv ID, or title).
Resolve access candidates via OpenAlex, DOI, PubMed/PMCID, arXiv, and Europe PMC; for a title, search OpenAlex first. Report candidates without bypassing paywalls.${fetchFullText ? ' With --fetch-full-text, fetch text only through source-sanctioned APIs and write bounded artifacts (summary + access record), never raw full-text dumps.' : ' No full-text fetch requested — access candidates only.'} Write outputs/${slugify(id)}-paper-access.md and outputs/${slugify(id)}-paper-access.json.${json ? ' Also print a compact JSON access summary after writing artifacts.' : ''}`
}

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
    hint: '<topic> [--limit N] [--expand-citations N] [--full-text-top N] [--critique-top N] [--preference-file F] [--reproduction-notes F] [--synthesize [--synthesis-top N] [--synthesis-model P/M]] [--output-dir D] [--json]',
    required: true,
    prompt: RANK_PROMPT,
  },
  paper: {
    description: 'Resolve legal full-text access candidates for one paper',
    hint: '<DOI | PubMed-ID | arXiv-ID | title> [--fetch-full-text] [--json]',
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

/** Session/utility subcommands of /feynman (handlers live in index.js). */
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
  doctor: 'Diagnose key state, mounted seams, pandoc, and the config card',
  status: 'Show the current setup summary (keys, refs, model route)',
}

/** Feynman's thinking levels, accepted by /thinking. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Prompt for one review-loop round after the first. */
// ponytail: fixed-round loop; add a findings-parser stop condition when early exit matters.
export function loopFollowupPrompt(target, round, remaining) {
  return `Review-loop round ${round} for "${target}" (${remaining} round(s) left after this one). Address the previous round's critical and major findings first using your tools, then re-review the updated state. Reply with: (1) what you changed or verified since last round, (2) the fresh severity-graded findings (critical/major/minor/nit), (3) whether the artifact is clean enough to stop early.`
}

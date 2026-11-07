# Cogniva validation and remaining problems

[Latest assignment and three-organization check](assignment-check.md) — includes Cursor fixes, 36 passing tests, and the remaining live AI failures.

Validated against the assignment and the nine supplied fictional PDFs on 7 November 2026. The video is excluded. Changes are uncommitted.

The application has stronger workflow guards and a reproducible evaluation suite. **It should not yet be described as fully reliable at personalized policy decisions.** Passing deterministic engineering tests and passing real AI examples are different claims.

## Focused minimal fix follow-up

The semantic combination rule now treats pass and fail symmetrically: exactly one Boolean head at or above the existing 0.65 threshold decides the outcome. Both supported or both inconclusive return Uncertain. Missing-fact and policy-coverage guards remain in place. Failure traces identify the violation score.

The [three-case live run](evaluation/gemini-minimal-decision-fix.json) verified the positive outcome and missing-GPA clarification. Its negative outcome exposed the symmetric veto bug; the [negative follow-up](evaluation/gemini-minimal-negative-followup.json) passed after that correction. All three targeted outcomes are now verified across these runs, using 11 capped Gemini calls in total. The 30 engineering tests and build also pass. This is a focused verification, not a new full-suite accuracy claim.

For rehearsal, use the original seeded PDFs with these verified questions. The supplied newer university PDFs have different concurrent-funding rules. Complex policies and indirect wording still need review.

## Supplied documents

All nine PDFs are readable, one-page documents. Copies are included under [fixtures/knowledge-base](../fixtures/knowledge-base); the originals in Downloads were not changed.

| Organization | Documents | Useful coverage |
| --- | --- | --- |
| Northbridge University | Academic Merit Scholarship Rules; Library Hours and Access; Student Funding Application Guide | Different continuing/first-year GPA thresholds, enrollment, good standing, funding caps, renewal, portal steps, required attachments, hours, and NORTH-17 reference. |
| Harborlight Makerspace | Equipment Booking Guide; Workshop Safety Rules; Membership and Hours | Laser/3D printer duration comparison, safety prerequisites, membership, guests, hours, and HARBOR-42 reference. |
| Cedar Grove Museum | Visitor Hours and Tickets; Group Tour Booking Guide; Accessibility and Entry Policy | Opening times, ticket prices, group booking, maximum group size, supervision, accessibility, and CEDAR-63 reference. |

These PDFs differ from the smaller original seed fixtures. For example, the new Northbridge policy permits external grants within a funding cap; the original seed policy prohibits concurrent athletic awards. Keep the datasets in separate organizations/databases during evaluation.

## Measured results

| Check | Observed result |
| --- | --- |
| Deterministic API, security, PDF, numeric, and workflow tests | **30/30 passed** on the final code. Models are controlled in these tests. |
| Type checking and client build | Passed. |
| Pre-change Qwen3 1.7B baseline | 3/9 acceptance checks passed. |
| Pre-change Qwen2.5 3B replacement baseline | 1/9 passed; larger was not better. |
| Full Gemini run on the nine supplied PDFs | **12/15 passed** before the final grounding guard. |
| Targeted Gemini follow-up | **2/2 passed**: the duration comparison and mixed hours/monkey question. |
| Gemma3 1B QAT on the revised workflow | 3/9 passed; not a reliable replacement. |
| Earlier explicit positive/negative scholarship checks | Positive returned Uncertain; negative hit a provider failure before policy evaluation. |

The follow-up is **not a clean new 14/15 full-suite result**. It confirms that two previously failing cases subsequently passed. A full run on the final code was not repeated after the request to stop spending time on difficult cases. Results involve different code snapshots and subsets; they are not a controlled model leaderboard or a statistical accuracy estimate.

Recorded evidence:

- [Full Gemini run](evaluation/gemini-real-pdfs.json)
- [Two grounding follow-ups](evaluation/gemini-grounding-followup.json)
- [Explicit scholarship checks](evaluation/gemini-explicit-decisions.json)
- [Gemma local run](evaluation/ollama-gemma.json)

The reports contain synthetic questions, answers, typed outputs, timings, and an implementation fingerprint. They contain no assistant tokens, passwords, or API credentials.

## Changes completed

| Area | Change and practical effect |
| --- | --- |
| Policy coverage | The server collects source requirements before matching visitor facts. Every collected rule ID is required in the fact schema. It reads all pages of selected policy documents and follows named references inside the same organization. A planner can no longer shorten its own condition list to omit the GPA check. |
| Routing | Clear personalized eligibility questions are forced through policy checking even if the planner says factual. General procedures and hours avoid unnecessary eligibility checks. These are general English intent guards, without organization-specific question handlers. |
| Combination and polarity | Separate requirements use all-condition logic. There is no model-supplied `all/any` switch or `expected: false` flag. Unsupported combinations and unparseable numeric rules remain unresolved. Lack of evidence is separated from an established violation. |
| Typed decisions | Laya classifies source-derived policy categories separately from numeric comparison. A rejected 120-minute booking must not cause the 90-minute rule to be treated as irrelevant. Choice and Boolean outputs remain separate from TypeScript arithmetic and result combination. |
| Final explanation | The composer receives the actual verdict and checks. Decision replies display verified policy excerpts with the computed result, preventing generated approval wording from overriding a failed or uncertain verdict. |
| Retrieval and citations | Removed the two-word overlap filter, reconstructed complete retrieved pages, and handled Markdown bullet/heading formatting and sentence-ending punctuation during quote checks. Words, numeric values, and ordering still have to match. |
| Mixed questions | Explicit subquestions are tracked in code. A model's statement that the PDFs lack information cannot be presented by citing an unrelated document disclaimer. Supported parts can survive alongside an unsupported-information message. |
| Factual wording | Supported paraphrases can be displayed. An excerpt used as a fallback needs a separate relevance check. These model checks improve grounding but do not prove universal semantic correctness. |
| Laya operation | Added real startup warm-up for Choice and Boolean, short focused inputs, bounded batches, serialized adapter calls, truncation detection, and a longer inference deadline. Startup was exercised successfully on this Mac. |
| Local memory | Ollama unloads its model after generation so its weights do not remain resident throughout Laya checks. Existing models were retained; the configured provider was not automatically replaced. |
| Evaluation | Added actual-PDF API evaluation in an isolated in-memory database, stage traces, call caps, free OpenRouter pricing verification, pacing, and quota-stop behavior. Existing organizations were not altered. |

No database schema changes or migration system were added. The 10-document, 20-page, and 10 MB assignment limits remain in place.

## Problems that remain

### 1. Basic semantic decisions: focused follow-up

The earlier explicit positive case had compliance 0.8666 and violation 0.4542; an inconclusive opposite head incorrectly vetoed approval. The negative follow-up revealed the same issue in reverse. The minimal combination fix above addresses both without changing the 0.65 support threshold or permitting missing required facts.

The basic explicit positive, negative, and missing-fact cases are now verified. Broader semantic calibration, indirect award names, and more complex policy structures remain outside this small fix. Earlier results below are retained as historical evidence.

### 2. Arbitrary natural-language policy interpretation is too broad for a quick reliable fix

Continuing versus first-year eligibility, initial application versus renewal, nested exceptions, alternative paths, and linked financial caps require richer policy structure. The current ledger recognizes common English wording; it is not a formal compiler for all possible documents.

For the assignment, keep these cases in clarification or human review. A later extension could offer administrator review of extracted source-backed conditions, categories, operators, and exceptions. That would improve predictability without hardcoding a business domain.

### 3. Small local generators are not dependable enough for the main demonstration

Qwen2.5 3B was downloaded and tested, but performed worse than the original model. Gemma3 1B QAT was also downloaded and tested; it often returned no answer despite relevant text. Neither was selected as the new default.

Attempts to pull the current Qwen3.5 0.8B and standard Gemma3 1B tags were rejected by the installed Ollama version. The compatible Gemma QAT tag worked. Ollama itself was not upgraded. More model shopping is not justified by the results so far.

Use the configured free-tier Gemini for the clearest current generation results, while treating Ollama as an optional local experiment. This does not solve the separate System 1 semantic-calibration problem.

### 4. Free cloud availability remains an external constraint

Gemini sometimes failed before returning a usable structured result; a subsequent comparison request succeeded. An OpenRouter free model also returned a rate-limit response and that run stopped. No paid model fallback or billing configuration was enabled.

Laya warm-up fixes the previous cold-start workflow problem. It cannot guarantee that an external API, memory-constrained laptop, or learned decision model never fails. Keep service failures distinct from “the document does not contain the answer.”

## Scope recommendation

Keep registration, PDF management, tenant isolation, share/embed links, grounded information questions, comparisons, and explicit partial answers in the MVP. Keep conservative decisions and the visible decision trace.

Rehearse the verified basic decision cases before recording; broader policy reliability remains limited. Leave complex financial reasoning, arbitrary exception trees, universal policy compilation, production deployment, and additional model experiments for later. No additional paid tool is needed for this scope.

## Reproducing checks

```sh
npm test
npm run build

# Supplied nine-PDF dataset; use a free-tier Gemini project.
npm run evaluate -- --provider gemini --max-cloud-calls 40

# Smaller original fixtures, generated as actual PDFs in the isolated test run.
npm run evaluate -- --demo --provider gemini --cases s-explicit-pass,s-explicit-fail --max-cloud-calls 6

# A short local run; this does not consume cloud API calls.
npm run evaluate -- --provider ollama --model gemma3:1b-it-qat --cases n-hours,m-hours,m-isolation
```

Start Laya and wait for its warm-up readiness message first. The default cloud-call cap is 12; requests are paced, automatic retries are disabled, and quota errors stop the suite. Reports go under ignored `data/evaluation/` unless another path is supplied. The evaluator cannot inspect Gemini project billing; use the free-tier project already configured.

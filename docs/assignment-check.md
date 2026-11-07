# Current assignment check

**8 November follow-up:** verification behavior and numeric fact extraction have changed. See [the verification update](verification-update.md) for the latest implementation, 52 passing automated tests, capped Gemini validation, and the remaining model limitations. The earlier results below remain historical evidence.

Checked on 7 November 2026 against the assignment PDF, Cursor's changes, and all nine PDFs under `fixtures/knowledge-base`. The video is excluded. No deployment is required by the assignment.

**Three-organization isolation passed the executed test matrix. The basic product features are implemented, but live AI answer accuracy still has two concrete gaps.**

## Three-organization isolation

The new [integration test](../server/tenants.test.ts) registers three independent accounts and organizations in a temporary SQLite database, uploads all nine actual repository PDFs through the API, and generates three distinct assistant tokens. Your normal database is untouched.

| Organization | PDFs uploaded and indexed | Own desk reference found |
| --- | --- | --- |
| Northbridge University | 3, all ready | NORTH-17 |
| Harborlight Makerspace | 3, all ready | HARBOR-42 |
| Cedar Grove Museum | 3, all ready | CEDAR-63 |

Checks passed:

- Each dashboard listed exactly its own three documents.
- All nine original PDFs downloaded correctly with their owner's session.
- All six off-diagonal assistant lookups returned no answer and no references.
- Foreign file download, delete, retry, and replacement requests were rejected: 18 foreign documents/actor combinations × four operations = **72 blocked attempts**.
- Document lists remained unchanged after those attempts.
- Search and full-policy expansion returned only document IDs owned by the resolved organization.
- Instrumented model inputs contained only the active organization's source names and no foreign reference codes. Positive lookups actually exercised the model-input path, preventing a vacuous isolation assertion.
- A supplied `org_id` or organization name did not override the assistant token's identity.
- Assistant tokens did not authorize the administrative dashboard; unauthenticated private downloads failed.
- Rotating one organization's token invalidated its old token and left the other two tokens valid.
- Logout invalidated the session, and subsequent login succeeded.

These are actual PDF, database, authentication, and HTTP-route checks with controlled AI outputs. They establish the tested access boundaries; they are not a claim that every possible attack has been tested.

## Assignment requirements

| Requirement | Assessment | Evidence / limit |
| --- | --- | --- |
| Organization registration, login/logout, dashboard | Verified through API; UI implementation inspected | Three real test accounts, dashboard access, logout/login checks. |
| Isolated knowledge bases and assistants | Passed the three-organization matrix | Actual nine PDFs and all six cross-organization lookup directions. |
| Ten PDF / twenty page / ten MB limits | Automated tests pass | Existing upload, invalid-PDF, page, byte, quota, and replacement tests. |
| View, delete, replace, retry documents | Automated tests pass | Original downloads, failed replacement retention, successful replacement, deletion, and foreign-operation rejection. |
| PDF processing, indexing, document/page references | Implemented and exercised | All nine fixture PDFs indexed; source quotes and page references validated. |
| Unique secure public assistant URL and rotation | Verified | Three independent tokens, public identity/ask APIs, invalidation on rotation. |
| Embeddable visitor chat | Implemented; code inspected | Dashboard iframe snippet, `/assistant`, and separate example HTML page. A fresh browser walkthrough was not performed in this check. |
| Organization identity in chat | Implemented; API verified | Token resolves the organization; client uses that name. |
| Retrieval → understanding → decisions → combination → answer | Implemented, live accuracy partial | Current positive eligibility case still returns Uncertain. |
| Meaningful LLM + System 1 use; at least two decision types | Implemented and exercised | LLM planning/fact matching/composition, Laya Choice and Boolean, numeric comparisons and combination in code. Learned checks remain imperfect. |
| Grounded answers and unsupported information | Partially reliable in live tests | Correct hours/citations for two organizations; Harborlight procedure loses valid instructions. Controlled mixed-question and unsupported-answer tests pass. |
| Multiple question categories and sample/test data | Present | Three organizations, nine supplied PDFs, fifteen labeled questions, plus original seed decision cases. |
| API/authentication/token/private-document security | Automated checks pass | Administrative authorization, server-side token resolution, tenant-scoped operations. |
| Meaningful errors and usage counts | Automated checks pass | Invalid inputs, limits, model failures, clarification/review and failed-request counts. External service availability is not guaranteed. |
| Source, environment example, schema setup, README | Present locally | Fresh schema setup, ignored secrets/data, architecture/setup/API documentation and sample data. Latest changes remain uncommitted/unpushed. |

## Fresh live AI checks

Both runs used the same current application implementation fingerprint and real Gemini + local Laya. They used isolated test databases, with **14 cloud calls total** and no automatic retries or paid-provider fallback.

### Supplied repository PDFs: 2/3 acceptance checks passed

| Question | Observed outcome |
| --- | --- |
| Northbridge weekday library hours | Correct: 08:00–18:00, citing Library Hours and Access.pdf page 1. |
| Harborlight laser-cutter booking procedure | Incomplete: returned the membership prerequisite but dropped valid Member Hub / Equipment > Book a Station instructions. |
| Cedar Grove weekend opening hours | Correct: 09:00–18:00, citing Visitor Hours and Tickets.pdf page 1. |

[Recorded results](evaluation/three-organizations-live.json).

### Original seeded decision PDFs: 2/3 acceptance checks passed

| Case | Observed outcome |
| --- | --- |
| Missing GPA | Correct: asks for GPA. |
| Explicitly eligible applicant | Uncertain, despite sufficient stated facts. |
| Explicit concurrent athletic award | Correct: Conditions not met, with the failing policy cited. |

[Recorded results](evaluation/cursor-fixes-decision-validation.json). These original seed policies differ from the newer university PDFs; their funding rules must not be mixed.

## The two remaining AI problems

1. **Positive eligibility false negative.** The new fact-sufficiency check passed at 0.8996. Compliance scored 0.8968 and violation scored 0.7258, so the unchanged combiner correctly returned Uncertain for conflicting model outputs. This is model/integration accuracy work, not evidence of a tenant leak or missing user facts.
2. **Procedural-answer verification false negative.** Gemini supplied the correct booking instructions and real supporting quotes. Paraphrase support scored 0.6532 / 0.5312 and fallback relevance scored 0.286 / 0.3083, so the verification layer discarded those valid instructions. The PDFs contain the answer; this was not a retrieval absence or an API failure.

These affect basic assignment examples and should be addressed before describing the AI flow as fully dependable. More complex exceptions, nested alternatives, financial comparisons, and numeric subject ambiguities remain documented MVP limitations. No further model-shopping or broad policy-compiler work was attempted during this check.

## Additional defect fixed during review

Cursor's new failing-rule prefix could renumber references without rewriting citation markers in the appended explanation. A test mock also marked unrelated conditions as failures, masking the mismatch. The mock now examines the policy line, a regression checks quote-to-reference bindings, and the response merge remaps appended citation IDs correctly.

## Verification

- `npm test`: **36/36 passed**.
- `npm run build`: passed.
- Three-organization integration test: passed with all nine actual PDFs.
- Fresh live sets: **2/3 information/procedure checks** and **2/3 seeded decision checks**. These small sets are not an overall accuracy estimate.
- No commit or push performed. The local development database and original PDF files were not modified by the evaluation.

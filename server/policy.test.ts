import assert from "node:assert/strict";
import { test } from "node:test";
import { answerQuestion } from "./ask.js";
import type { Models } from "./models.js";
import { containsQuote, policyRules } from "./policy.js";
import type { Passage } from "./store.js";

const evidence: Passage[] = [{id: "E1", name: "Membership Policy.pdf", page: 1, text: [
  "# Membership Policy", "## Initial membership",
  "Applicants must complete orientation.",
  "Applicants need a GPA of 3.5 or above.",
  "Applicants must not hold a concurrent restricted award.",
].join("\n")}];

function controlled(options: {
  missing?: string; fail?: boolean; uncertainScope?: boolean; plan?: string; falseApproval?: boolean;
  compliance?: number; violation?: number; addresses?: number; unrelatedAward?: boolean; awardFact?: string;
} = {}) {
  let composerInput: {decision?: {verdict: string}} | undefined;
  const facts = {
    orientation: "I completed orientation",
    GPA: "GPA 3.6",
    award: options.unrelatedAward ? "My dorm is North Hall"
      : options.awardFact ?? (options.fail ? "I hold a concurrent restricted award" : "I hold no concurrent restricted award"),
  };
  const question = `Am I eligible? ${Object.entries(facts).filter(([key]) => key !== options.missing).map(([,fact]) => fact).join(". ")}.`;
  const models: Models = {
    async generate(name, _schema, _instructions, input) {
      if (name === "question_plan") return {kind: options.plan ?? "decision", evidenceIds: ["E1"], policy: "Membership"};
      if (name === "policy_facts") {
        const {rules} = input as {rules: {id: string; rule: string}[]};
        return Object.fromEntries(rules.map(rule => {
          const key = rule.rule.includes("orientation") ? "orientation" : rule.rule.includes("GPA") ? "GPA" : "award";
          return [rule.id, key === options.missing ? "" : facts[key]];
        }));
      }
      composerInput = input as typeof composerInput;
      return {parts: [{question, claims: [{text: options.falseApproval ? "You meet all the policy conditions." : evidence[0].text.split("\n")[2], quote: evidence[0].text.split("\n")[2], evidenceId: "E1"}]}]};
    },
    async decide(states, questions) {
      return states.map(state => Object.fromEntries(Object.keys(questions).map(key => {
        if (key === "scope") return [key, {type: "choice", choice: options.uncertainScope ? "irrelevant" : "applies", probabilities: {applies: options.uncertainScope ? 0.45 : 0.95, irrelevant: options.uncertainScope ? 0.55 : 0.05}}];
        const awardState = /^Policy: .*restricted award/im.test(state);
        const violates = Boolean(options.fail && awardState);
        const unrelated = Boolean(options.unrelatedAward && awardState);
        const value = key === "applicability" ? 0.95
          : key === "addresses" ? (unrelated ? 0.12 : options.addresses ?? 0.95)
          : key === "violation" ? options.violation ?? (violates ? 0.95 : 0.05)
            : options.compliance ?? (violates ? 0.05 : 0.95);
        return [key, {type: "noul", noul: value}];
      })));
    },
  };
  return {models, question, composer: () => composerInput};
}

test("a fixed source ledger preserves a missing requirement even when the planner selects factual", async () => {
  const model = controlled({missing: "GPA", plan: "factual"});
  const answer = await answerQuestion(model.models, model.question, evidence);
  assert.equal(answer.status, "needs_clarification");
  assert.match(answer.text, /GPA/);
  assert.equal(answer.decision, undefined);
  assert.equal(policyRules(evidence).length, 3);
});

test("one supported outcome decides; conflicting or undecided outcomes require review", async () => {
  for (const [compliance, violation, verdict] of [
    [0.8666, 0.4542, "Conditions met"], [0.4226, 0.8169, "Conditions not met"],
    [0.9, 0.9, "Uncertain"], [0.4, 0.4, "Uncertain"],
  ] as const) {
    const model = controlled({compliance, violation});
    assert.equal((await answerQuestion(model.models, model.question, evidence)).decision?.verdict, verdict);
  }
  const missing = controlled({missing: "orientation", compliance: 0.8666, violation: 0.4542});
  assert.equal((await answerQuestion(missing.models, missing.question, evidence)).status, "needs_clarification");
});

test("required checks use all conditions; 'or above' cannot turn them into alternatives", async () => {
  const model = controlled({fail: true});
  const answer = await answerQuestion(model.models, model.question, evidence);
  assert.equal(answer.decision?.verdict, "Conditions not met");
  assert.ok(answer.decision.checks.some(check => check.method === "Rule" && check.result === "Pass"));
  assert.ok(answer.decision.checks.some(check => check.method === "Boolean (Noul)" && check.result === "Fail"));
  assert.equal(model.composer()?.decision?.verdict, "Conditions not met");
});

test("the composer receives the calculated verdict and independent typed checks", async () => {
  const model = controlled();
  const answer = await answerQuestion(model.models, model.question, evidence);
  assert.equal(answer.decision?.verdict, "Conditions met");
  assert.equal(model.composer()?.decision?.verdict, answer.decision.verdict);
  assert.deepEqual(new Set(answer.decision.checks.map(check => check.method)), new Set(["Choice", "Rule", "Boolean (Noul)"]));
});

test("an uncertain applicability exclusion cannot silently remove a mandatory rule", async () => {
  const model = controlled({uncertainScope: true});
  const answer = await answerQuestion(model.models, model.question, evidence);
  assert.equal(answer.decision?.verdict, "Uncertain");
  assert.ok(!answer.decision.checks.some(check => check.result === "Not applicable"));
});

test("citations ignore extraction markup while retaining words, numbers and ordering", () => {
  const source = "- **Transcript:** an official transcript.\n- **Identity:** a student ID.\n- Maximum 60 minutes.";
  assert.equal(containsQuote(source, "Transcript: an official transcript. Identity: a student ID."), true);
  assert.equal(containsQuote(source, "Identity: a student ID. Transcript: an official transcript."), false);
  assert.equal(containsQuote(source, "Transcript: an unofficial transcript."), false);
  assert.equal(containsQuote(source, "6"), false);
});

test("a generated approval cannot override the computed failed verdict", async () => {
  const model = controlled({fail: true, falseApproval: true});
  const answer = await answerQuestion(model.models, model.question, evidence);
  assert.equal(answer.decision?.verdict, "Conditions not met");
  assert.match(answer.text, /do not meet all/);
  assert.match(answer.text, /must not hold a concurrent restricted award/i);
  assert.doesNotMatch(answer.text, /You meet all the policy conditions/);
  for (const reference of answer.references) {
    assert.ok(answer.text.includes(`${reference.quote} [[${reference.id}]]`), "Every displayed quote must point to its own reference");
  }
});

test("question wording cannot route a personalized eligibility assessment around mandatory checks", async () => {
  const model = controlled({missing: "GPA", plan: "factual"});
  const question = model.question.replace("Am I eligible?", "Which eligibility rules apply to my application?");
  const answer = await answerQuestion(model.models, question, evidence);
  assert.equal(answer.status, "needs_clarification");
  assert.match(answer.text, /GPA/);
});

test("numeric conditions and prohibitions remain requirements when extracted as headings", () => {
  const rules = policyRules([{id: "E1", name: "Policy.pdf", page: 1, text: [
    "# Policy", "## Minimum GPA: 3.5", "## Eligible academic years: 2, 3, 4", "## Athletic awards are prohibited as concurrent aid.",
  ].join("\n")}]);
  assert.equal(rules.length, 3);
});

test("section headings and duplicate summary cards do not become extra policy checks", () => {
  const extracted = policyRules([{id: "E1", name: "Booking.pdf", page: 1, text: [
    "# Equipment Booking", "LASER CUTTER SESSION 90 minutes maximum", "3D PRINTER SESSION 180 minutes maximum",
    "## Maximum booking durations", "Laser cutter: maximum 90 minutes per reservation, including setup and cleanup.",
    "3D printer: maximum 180 minutes per standard reservation, including setup and cleanup.",
    "## MAXIMUM GROUP SIZE: 12.", "Applicants must complete orientation.",
  ].join("\n")}]);
  assert.equal(extracted.length, 4);
  assert.ok(!extracted.some(rule => rule.source.quote === "Maximum booking durations"));
  assert.ok(!extracted.some(rule => /SESSION/.test(rule.source.quote)));
  assert.ok(extracted.some(rule => /MAXIMUM GROUP SIZE/.test(rule.source.quote)));
  assert.ok(extracted.some(rule => rule.category === "3D printer"));
  assert.deepEqual(extracted.map(rule => rule.id), ["R1", "R2", "R3", "R4"]);
});

test("summary deduplication preserves distinct units and accounting periods", () => {
  for (const [card, detail] of [
    ["WORKSHOP SESSION 12 tokens maximum", "Workshop: maximum 12 sessions per reservation."],
    ["WORKSHOP ANNUAL 12 hours maximum", "Workshop: maximum 12 hours per reservation."],
    ["WORKSHOP SESSION 12 hours maximum", "Workshop: maximum 12 hours per year."],
  ]) {
    assert.equal(policyRules([{id: "E1", name: "Policy.pdf", page: 1, text: `${card}\n${detail}`}]).length, 2, `${card} vs ${detail}`);
  }
});

test("a quoted hyphenated visitor quantity fails its source limit even when another fact is missing", async () => {
  const quote = "Workbench: maximum 90 minutes per reservation, including setup and cleanup.";
  const passages: Passage[] = [{id: "E1", name: "Booking.pdf", page: 1, text: `## Maximum booking durations\n${quote}\nMembers must complete orientation.`}];
  const question = "Can I book a 120-minute workbench reservation?";
  const models: Models = {
    async generate(stage, _schema, _instructions, input) {
      if (stage === "question_plan") return {kind: "decision", policy: "Booking", evidenceIds: ["E1"]};
      if (stage === "policy_facts") {
        const {rules} = input as {rules: {id: string; rule: string}[]};
        return Object.fromEntries(rules.map(rule => [rule.id, rule.rule === quote ? "120-minute" : ""]));
      }
      return {parts: [{question, claims: [{text: quote, quote, evidenceId: "E1"}]}]};
    },
    async decide(states, questions) {
      return states.map(() => Object.fromEntries(Object.keys(questions).map(key => [key, key === "scope"
        ? {type: "choice", choice: "applies", probabilities: {applies: 0.95, irrelevant: 0.05}}
        : {type: "noul", noul: 0.95}])));
    },
  };
  const answer = await answerQuestion(models, question, passages);
  assert.equal(answer.decision?.verdict, "Conditions not met");
  assert.ok(answer.decision.checks.some(check => check.method === "Rule" && check.result === "Fail"));
  assert.match(answer.text, /90 minutes/);
  assert.match(answer.text, /missing.*orientation/i);
  assert.ok(!answer.decision.checks.some(check => check.label === "Maximum booking durations"));
});

test("numeric fact correction can select only actual visitor excerpts, not policy thresholds", async () => {
  for (const valid of [true, false]) {
    const quote = "Groups: maximum 30 participants total.";
    const question = "Can our group book for 32 participants? We are booking 15 days ahead.";
    let repairs = 0;
    const models: Models = {
      async generate(stage, _schema, _instructions, input) {
        if (stage === "question_plan") return {kind: "decision", policy: "Booking", evidenceIds: ["E1"]};
        if (stage === "policy_facts") return {R1: "30 participants"};
        if (stage === "numeric_facts") {
          repairs++;
          const {candidates} = input as {candidates: {id: string; text: string}[]};
          assert.ok(candidates.every(candidate => question.includes(candidate.text)));
          assert.ok(!candidates.some(candidate => candidate.text.includes("30")));
          return {R1: valid ? candidates.find(candidate => candidate.text.includes("32"))!.id : "V999"};
        }
        return {parts: [{question, claims: [{text: quote, quote, evidenceId: "E1"}]}]};
      },
      async decide(states) {
        return states.map(() => ({scope: {type: "choice", choice: "applies", probabilities: {applies: 0.95}}, applicability: {type: "noul", noul: 0.95}}));
      },
    };
    const answer = await answerQuestion(models, question, [{id: "E1", name: "Booking.pdf", page: 1, text: quote}]);
    assert.equal(repairs, 1);
    if (valid) assert.equal(answer.decision?.verdict, "Conditions not met");
    else assert.equal(answer.status, "needs_clarification");
  }
});

test("an incomplete policy ledger reports unresolved rather than missing knowledge", async () => {
  const question = "Am I eligible for membership?";
  const models: Models = {
    async generate(stage) {
      return stage === "question_plan" ? {kind: "decision", policy: "Membership", evidenceIds: ["E1"]}
        : {parts: [{question, claims: []}]};
    },
    async decide() { assert.fail("No complete policy ledger is available"); },
  };
  const answer = await answerQuestion(models, question, [{id: "E1", name: "Policy.pdf", page: 1, text: "## Minimum membership requirements"}]);
  assert.equal(answer.status, "unresolved");
  assert.match(answer.text, /complete set of policy checks/);
  assert.doesNotMatch(answer.text, /don’t contain/);
});

test("a permissive adjective is not mistaken for a required condition", () => {
  const rules = policyRules([{id: "E1", name: "Policy.pdf", page: 1, text: "Need-based awards are allowed. Applicants need an active membership."}]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source.quote, "Applicants need an active membership.");
});

test("common obligation wording stays in the ledger so a partial policy cannot be approved", async () => {
  const policy: Passage[] = [{id: "E1", name: "Policy.pdf", page: 1, text: [
    "# Policy",
    "Applicants must complete orientation.",
    "Applicants shall hold an active membership.",
    "Applicants have to submit a signed waiver.",
    "Concurrent athletic awards may not be held.",
    "MAXIMUM GROUP SIZE: 12.",
  ].join("\n")}];
  const extracted = policyRules(policy).map(rule => rule.source.quote);
  assert.ok(extracted.some(quote => /shall hold an active membership/i.test(quote)));
  assert.ok(extracted.some(quote => /have to submit a signed waiver/i.test(quote)));
  assert.ok(extracted.some(quote => /may not be held/i.test(quote)));
  assert.ok(extracted.some(quote => /MAXIMUM GROUP SIZE:\s*12/i.test(quote)));
  assert.equal(extracted.length, 5);

  const facts: Record<string, string> = {
    orientation: "I completed orientation",
    membership: "",
    waiver: "I submit a signed waiver",
    award: "I hold no concurrent athletic awards",
    group: "group size 8",
  };
  const question = "Am I eligible? I completed orientation. I submit a signed waiver. I hold no concurrent athletic awards. My group size is 8.";
  const models: Models = {
    async generate(name, _schema, _instructions, input) {
      if (name === "question_plan") return {kind: "decision", evidenceIds: ["E1"], policy: "Policy"};
      if (name === "policy_facts") {
        const {rules} = input as {rules: {id: string; rule: string}[]};
        return Object.fromEntries(rules.map(rule => {
          const key = /orientation/i.test(rule.rule) ? "orientation"
            : /shall hold|membership/i.test(rule.rule) ? "membership"
              : /waiver/i.test(rule.rule) ? "waiver"
                : /may not|athletic/i.test(rule.rule) ? "award"
                  : "group";
          return [rule.id, facts[key]];
        }));
      }
      return {parts: [{question, claims: [{text: "Applicants must complete orientation.", quote: "Applicants must complete orientation.", evidenceId: "E1"}]}]};
    },
    async decide(states, questions) {
      return states.map(() => Object.fromEntries(Object.keys(questions).map(key => {
        if (key === "scope") return [key, {type: "choice", choice: "applies", probabilities: {applies: 0.95, irrelevant: 0.05}}];
        return [key, {type: "noul", noul: key === "violation" ? 0.05 : 0.95}];
      })));
    },
  };
  const answer = await answerQuestion(models, question, policy);
  assert.equal(answer.status, "needs_clarification");
  assert.match(answer.text, /shall hold an active membership/i);
  assert.equal(answer.decision, undefined);
});

test("an unrelated visitor fact cannot satisfy a semantic prohibition", async () => {
  const model = controlled({unrelatedAward: true, compliance: 0.9, violation: 0.05});
  const answer = await answerQuestion(model.models, model.question, evidence);
  assert.equal(answer.status, "needs_clarification");
  assert.match(answer.text, /restricted award/i);
  assert.equal(answer.decision, undefined);
});

test("an explicit absence statement remains a usable fact for a prohibition", async () => {
  const model = controlled({awardFact: "I hold no concurrent restricted award", compliance: 0.9, violation: 0.05, addresses: 0.92});
  const answer = await answerQuestion(model.models, model.question, evidence);
  assert.equal(answer.decision?.verdict, "Conditions met");
});

test("ambiguous fact coverage stays under review rather than approving", async () => {
  const model = controlled({addresses: 0.5, compliance: 0.9, violation: 0.05});
  const answer = await answerQuestion(model.models, model.question, evidence);
  assert.equal(answer.decision?.verdict, "Uncertain");
  assert.equal(answer.status, "unresolved");
});

test("a rejection cites the failing rule and can mention missing checks", async () => {
  const model = controlled({fail: true, missing: "orientation", falseApproval: true});
  const answer = await answerQuestion(model.models, model.question, evidence);
  assert.equal(answer.decision?.verdict, "Conditions not met");
  assert.match(answer.text, /must not hold a concurrent restricted award/i);
  assert.match(answer.text, /required facts were also missing/i);
  assert.match(answer.text, /orientation/i);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { answerQuestion } from "./ask.js";
import type { Models } from "./models.js";
import { RequestError, type Passage } from "./store.js";

const source: Passage[] = [{id: "E1", name: "Visitor Guide.pdf", page: 2, text: [
  "# Visitor Guide", "## Equipment access",
  "Guests may observe demonstrations but cannot operate restricted equipment.",
  "## Reservations", "Members reserve a station through the Member Hub > Equipment > Book a Station.",
  "## Service desk", "The service desk reference code is HARBOR-42.",
].join("\n")}];
type Claim = {text: string; quote: string; evidenceId: string};
type Review = {supported: string; relevant: string; quoteRelevant: string};
const yes: Review = {supported: "yes", relevant: "yes", quoteRelevant: "yes"};

function model(question: string, claims: Claim[], options: {
  review?: Review; failure?: "unavailable" | "malformed"; parts?: {question: string; claims: Claim[]}[];
} = {}) {
  const stages: string[] = [];
  const models: Models = {
    async generate(stage, _schema, _instructions, input) {
      stages.push(stage);
      if (stage === "question_plan") return {kind: "factual", policy: "", evidenceIds: ["E1"]};
      if (stage === "grounded_answer") return {parts: options.parts ?? [{question, claims}]};
      assert.equal(stage, "answer_review");
      if (options.failure === "unavailable") throw new RequestError(503, "Reviewer unavailable");
      if (options.failure === "malformed") return {};
      const {claims: candidates, passages} = input as {claims: {id: string; candidateQuote: string}[]; passages: Passage[]};
      assert.ok(passages.length > 0 && passages.every(p => source.some(s => s.id === p.id && s.text === p.text)));
      return Object.fromEntries(candidates.map(claim => [claim.id, {...options.review ?? yes, quote: claim.candidateQuote}]));
    },
    async decide() { assert.fail("Factual answers must not depend on a Laya score"); },
  };
  return {models, stages};
}
const claim = (quote: string, text = quote): Claim => ({text, quote, evidenceId: "E1"});

test("verbatim facts, prohibitions and procedures survive without a Laya relevance veto", async () => {
  for (const [question, quote] of [
    ["What is the visitor desk reference code?", "The service desk reference code is HARBOR-42."],
    ["Can guests operate independently?", "Guests may observe demonstrations but cannot operate restricted equipment."],
    ["How do I reserve a station?", "Members reserve a station through the Member Hub > Equipment > Book a Station."],
  ]) {
    const stub = model(question, [claim(quote)]);
    const answer = await answerQuestion(stub.models, question, source);
    assert.equal(answer.status, "answered");
    assert.equal(answer.text, `${quote} [[E1]]`);
    assert.equal(answer.references[0].page, 2);
    assert.deepEqual(stub.stages, ["question_plan", "grounded_answer", "answer_review"]);
  }
});

test("support alone cannot admit an authentic but unrelated quotation", async () => {
  const question = "What is the annual membership fee?";
  const stub = model(question, [claim("The service desk reference code is HARBOR-42.")], {
    review: {supported: "yes", relevant: "no", quoteRelevant: "no"},
  });
  const answer = await answerQuestion(stub.models, question, source);
  assert.equal(answer.status, "no_answer");
  assert.deepEqual(answer.references, []);
  assert.doesNotMatch(answer.text, /HARBOR-42/);
});

test("discarding an unrelated extra claim does not imply the requested answer is incomplete", async () => {
  const question = "Can guests operate independently?";
  const quote = "Guests may observe demonstrations but cannot operate restricted equipment.";
  const stub = model(question, [claim(quote), claim("The service desk reference code is HARBOR-42.")]);
  const generate = stub.models.generate;
  stub.models.generate = async (...args) => args[0] === "answer_review"
    ? {C1: {...yes, quote}, C2: {supported: "yes", relevant: "no", quoteRelevant: "no", quote: ""}}
    : generate(...args);
  const answer = await answerQuestion(stub.models, question, source);
  assert.equal(answer.text, `${quote} [[E1]]`);
  assert.equal(answer.references.length, 1);
});

test("a relevant-quote vote cannot override an unsupported or polarity-inverted claim", async () => {
  const question = "Can guests operate independently?";
  const quote = "Guests may observe demonstrations but cannot operate restricted equipment.";
  const stub = model(question, [claim(quote, "Guests can operate restricted equipment independently.")], {
    review: {supported: "no", relevant: "yes", quoteRelevant: "yes"},
  });
  const answer = await answerQuestion(stub.models, question, source);
  assert.equal(answer.status, "unresolved");
  assert.deepEqual(answer.references, []);
  assert.doesNotMatch(answer.text, /Guests can operate/);
});

test("a changed unit is rejected even when the answer repeats an authentic number", async () => {
  const question = "How long can a booking last?";
  const passages: Passage[] = [{id: "E1", name: "Policy.pdf", page: 1, text: "Maximum duration: 90 minutes."}];
  const stub = model(question, [claim(passages[0].text, "The maximum duration is 90 hours.")]);
  stub.models.generate = async stage => {
    if (stage === "question_plan") return {kind: "factual", policy: "", evidenceIds: ["E1"]};
    if (stage === "grounded_answer") return {parts: [{question, claims: [claim(passages[0].text, "The maximum duration is 90 hours.")]}]};
    // A real Gemini review incorrectly marked this unit change as supported.
    return {C1: {supported: "yes", relevant: "yes", quoteRelevant: "yes", quote: passages[0].text}};
  };
  const answer = await answerQuestion(stub.models, question, passages);
  assert.equal(answer.status, "answered");
  assert.match(answer.text, /90 minutes/);
  assert.doesNotMatch(answer.text, /90 hours/);
});

test("the recorded Gemini review conflict cannot substitute the current organization's code for another's", async () => {
  const question = "What is Northbridge University's library desk reference code?";
  const passage: Passage = {id: "E1", name: "Accessibility and Entry Policy.pdf", page: 1,
    text: "# Cedar Grove Museum\nDESK REFERENCE CODE CEDAR-63\nThe fictional front desk reference code is CEDAR-63."};
  const models: Models = {
    async generate(stage) {
      if (stage === "question_plan") return {kind: "factual", policy: "", evidenceIds: ["E1"]};
      if (stage === "grounded_answer") return {parts: [{question, claims: [claim("The fictional front desk reference code is CEDAR-63.")]}]};
      return {C1: {supported: "no", relevant: "yes", quoteRelevant: "yes", quote: "DESK REFERENCE CODE CEDAR-63"}};
    },
    async decide() { assert.fail("A factual review conflict needs no policy decision"); },
  };
  const answer = await answerQuestion(models, question, [passage]);
  assert.equal(answer.status, "unresolved");
  assert.deepEqual(answer.references, []);
  assert.doesNotMatch(answer.text, /CEDAR-63/);
});

test("uncertain, unavailable and malformed reviews report unresolved instead of missing knowledge", async () => {
  const question = "Can guests operate independently?";
  const quote = "Guests may observe demonstrations but cannot operate restricted equipment.";
  for (const options of [
    {review: {supported: "uncertain", relevant: "uncertain", quoteRelevant: "uncertain"}},
    {failure: "unavailable" as const}, {failure: "malformed" as const},
  ]) {
    const stub = model(question, [claim(quote)], options);
    const answer = await answerQuestion(stub.models, question, source);
    assert.equal(answer.status, "unresolved");
    assert.match(answer.text, /couldn’t verify/);
    assert.doesNotMatch(answer.text, /don’t contain/);
    assert.deepEqual(answer.references, []);
  }
});

test("foreign sources and fabricated quotes cannot be returned", async () => {
  const question = "What is the visitor desk reference code?";
  const quote = "The service desk reference code is HARBOR-42.";
  for (const candidate of [
    {...claim(quote), evidenceId: "FOREIGN"}, claim("An invented source quote."),
  ]) {
    const stub = model(question, [candidate]);
    const answer = await answerQuestion(stub.models, question, source);
    assert.equal(answer.status, "unresolved");
    assert.deepEqual(answer.references, []);
    assert.deepEqual(stub.stages, candidate.evidenceId === "FOREIGN" ? ["question_plan", "grounded_answer"] : ["question_plan", "grounded_answer", "answer_review"]);
  }
});

test("a review can repair a draft citation only with a real excerpt from the cited page", async () => {
  const question = "What is the visitor desk reference code?";
  const quote = "The service desk reference code is HARBOR-42.";
  const stub = model(question, [claim("Invented draft quotation.", "The desk code is HARBOR-42.")]);
  const generate = stub.models.generate;
  stub.models.generate = async (...args) => args[0] === "answer_review" ? {C1: {...yes, quote}} : generate(...args);
  const answer = await answerQuestion(stub.models, question, source);
  assert.equal(answer.status, "answered");
  assert.equal(answer.references[0].quote, quote);
  assert.doesNotMatch(answer.text, /Invented/);
});

test("one review batches claims while preserving answers and gaps per question", async () => {
  const first = "Can guests operate independently?";
  const second = "What is the annual membership fee?";
  const question = `${first} Also ${second}`;
  const quote = "Guests may observe demonstrations but cannot operate restricted equipment.";
  const stub = model(question, [], {parts: [{question: first, claims: [claim(quote)]}, {question: second, claims: []}]});
  const answer = await answerQuestion(stub.models, question, source);
  assert.equal(answer.status, "answered");
  assert.match(answer.text, /cannot operate/);
  assert.match(answer.text, /couldn’t find a supported answer.*annual membership fee/);
  assert.equal(stub.stages.filter(stage => stage === "answer_review").length, 1);
  const empty = model(second, []);
  assert.equal((await answerQuestion(empty.models, second, source)).status, "no_answer");
  assert.ok(!empty.stages.includes("answer_review"));
});

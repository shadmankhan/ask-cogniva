import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Answer } from "../../shared/contracts.js";
import { AnswerView, revealSource } from "./answer.js";

const reference = { id: "E1", name: "Visitor Guide.pdf", page: 2, quote: "The front desk opens at 10:00." };
const base: Answer = { status: "answered", text: "The front desk opens at 10:00. [[E1]]", references: [reference] };
const render = (answer: Answer, index = 0) => renderToStaticMarkup(<AnswerView answer={answer} index={index} />);

test("answer cards preserve text, page citations and unique source targets across turns", () => {
  const html = renderToStaticMarkup(<><AnswerView answer={base} index={0} /><AnswerView answer={base} index={1} /></>);
  assert.match(html, /The front desk opens at 10:00/);
  for (const prefix of ["answer-0", "answer-1"]) {
    assert.ok(html.includes(`href="#${prefix}-E1"`));
    assert.ok(html.includes(`id="${prefix}-E1"`));
  }
  assert.match(html, /Visitor Guide.pdf/);
  assert.match(html, /Page 2/);
  assert.match(html, /<details class="answer-sources">/);
  assert.doesNotMatch(html, /\[\[E1\]\]/);
  assert.doesNotMatch(html, /data-fallback/);
});

test("unknown citation markers are omitted instead of shown as raw brackets", () => {
  const html = render({ ...base, text: "Supported [[E1]] and unknown [[E9]]." });
  assert.match(html, /Supported/);
  assert.match(html, /and unknown/);
  assert.doesNotMatch(html, /\[\[E9\]\]|\[\[E1\]\]/);
  assert.match(html, /Visitor Guide.pdf · p\. 2/);
});

test("computed verdicts and individual checks retain their meaning without inventing confidence", () => {
  for (const verdict of ["Conditions met", "Conditions not met", "Uncertain"] as const) {
    const html = render({ ...base, decision: { verdict, checks: [
      { label: "Requested duration", method: "Rule", result: "Fail" },
      { label: "Policy category", method: "Choice", result: "applies", score: 0.81 },
      { label: "Required information", method: "Boolean (Noul)", result: "Missing" },
    ] } });
    assert.ok(html.includes(verdict));
    assert.match(html, /Requested duration/);
    assert.match(html, /data-result="Fail"/);
    assert.match(html, /Result:/);
    assert.match(html, /Does not meet policy/);
    assert.match(html, /Method:/);
    assert.match(html, /Numeric comparison/);
    assert.match(html, /Category selection \(Choice\)/);
    assert.match(html, /Condition check \(Boolean \/ Noul\)/);
    assert.match(html, /More details needed/);
    assert.match(html, /Model output:/);
    assert.match(html, /0\.81/);
    assert.doesNotMatch(html, /81%/);
    if (verdict === "Conditions not met") assert.match(html, /data-tone="negative"/);
  }
  const review = render({ ...base, status: "unresolved", decision: { verdict: "Conditions met", checks: [] } });
  assert.match(review, /Needs review/);
  assert.doesNotMatch(review, /Conditions met|data-tone="positive"/);
});

test("non-answer states remain distinct and untrusted text is rendered as text", () => {
  for (const [status, label] of [
    ["no_answer", "No supported answer"], ["needs_clarification", "More details needed"],
    ["unresolved", "Needs review"], ["acknowledged", "Message"],
  ] as const) {
    const html = render({ status, text: '<img src=x onerror="alert(1)">', references: [] });
    assert.ok(html.includes(label));
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, /<img|answer-sources|data-tone="positive"/);
  }
});

test("a catalog mismatch falls back without losing the answer or its evidence", () => {
  const html = render({ ...base, references: [{ ...reference, page: 0 }] });
  assert.match(html, /data-fallback="true"/);
  assert.match(html, /The front desk opens at 10:00/);
  assert.match(html, /Visitor Guide.pdf/);
  assert.match(html, /id="answer-0-E1"/);
  assert.doesNotMatch(html, /p\. 0|Page 0/);
});

test("citation activation opens the source card and focuses it", () => {
  const details = { open: false };
  const source = {
    closest: (selector: string) => selector === "details" ? details : null,
    scrollIntoView: () => { source.scrolled = true; },
    focus: () => { source.focused = true; },
    scrolled: false,
    focused: false,
  };
  const root = {
    querySelector: (selector: string) => selector === "#answer-0-E1" ? source : null,
  };
  assert.equal(revealSource("answer-0", "E1", root as unknown as ParentNode), true);
  assert.equal(details.open, true);
  assert.equal(source.focused, true);
  assert.equal(source.scrolled, true);
  assert.equal(revealSource("answer-0", "E9", root as unknown as ParentNode), false);
});

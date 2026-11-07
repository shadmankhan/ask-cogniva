import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateNumeric, isNumericCondition } from "./rules.js";

test("numeric comparisons preserve inclusive boundaries, ranges, units, and scales", () => {
  const cases = [
    ["GPA of 3.5 or above", "3.5", "Pass"],
    ["GPA of 3.5 or above", "3.49", "Fail"],
    ["GPA of 3.5 or higher", "3.5", "Pass"],
    ["Age 18 or older", "18", "Pass"],
    ["Age 18 or older", "17", "Fail"],
    ["A payment of $50 or less", "$50", "Pass"],
    ["A payment of $50 or less", "$51", "Fail"],
    ["Score 70 or below", "70", "Pass"],
    ["Score 70 or lower", "71", "Fail"],
    ["More than 3.5", "3.5", "Fail"],
    ["Less than 3.5", "3.5", "Fail"],
    ["No more than 3.5", "3.5", "Pass"],
    ["No less than 3.5", "3.5", "Pass"],
    ["Exactly 3.5", "3.5", "Pass"],
    ["At least 3.5 (out of 4.0)", "GPA 3.5", "Pass"],
    ["At least 3.5 (out of 4.0)", "GPA 3.5 out of 4.0", "Pass"],
    ["At least 3.5 (out of 4.0)", "GPA 7 out of 10", "Uncertain"],
    ["At least 3.5 (out of 4.0)", "GPA 4.5", "Uncertain"],
    ["GPA between 3.0 and 3.5", "3.0", "Pass"],
    ["GPA between 3.0 and 3.5", "3.5", "Pass"],
    ["GPA between 3.0 and 3.5", "3.6", "Fail"],
    ["Academic years 2 through 4", "year 3", "Pass"],
    ["Academic years 2 through 4", "year 5", "Fail"],
    ["Ages 18-21", "21", "Pass"],
    ["Eligible years 2, 3, 4", "year 3", "Pass"],
    ["Eligible years 2, 3, 4", "year 1", "Fail"],
    ["Minimum payment of 2,000 credits", "2,000 credits", "Pass"],
    ["Maximum duration of 90 minutes", "1 hour", "Uncertain"],
    ["2,000 credits", "2,000 credits", "Uncertain"],
    ["Minimum GPA", "3.5", "Uncertain"],
    ["GPA must not be between 3.0 and 3.5", "3.2", "Uncertain"],
    ["Scores over 3.5 are prohibited", "3.6", "Uncertain"],
    ["Applicants with scores less than 3.5 are ineligible", "3.0", "Uncertain"],
  ] as const;
  for (const [quote, fact, expected] of cases) {
    assert.equal(evaluateNumeric(quote, fact), expected, `${quote} with ${fact}`);
    assert.equal(isNumericCondition(quote, fact), true);
  }
  assert.equal(isNumericCondition("Safety training is required.", "I completed safety training."), false);
});

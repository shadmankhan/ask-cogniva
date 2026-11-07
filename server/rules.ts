const comparisons = {
  at_least: /\b(?:at least|minimum|no less than|not less than|no fewer than|not below)\b|≥|>=/i,
  at_most: /\b(?:at most|maximum|up to|no more than|not more than|not above|not over)\b|≤|<=/i,
  greater_than: /(?<!no |not )\b(?:more than|greater than|over|above|higher than|older than)\b|>(?!=)/i,
  less_than: /(?<!no |not )\b(?:less than|under|below|lower than|younger than)\b|<(?!=)/i,
  equals: /\b(?:exactly|equals?)\b/i,
};

export function numbers(text: string) {
  return (text.match(/(?<![\p{L}\p{N}.])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\p{L}\p{N}])/gu) ?? [])
    .map(value => Number(value.replace(/,/g, "")));
}

function measurement(text: string) {
  const scale = text.match(/\bout of\s+(\d+(?:\.\d+)?)/i);
  const value = text.replace(/\bout of\s+\d+(?:\.\d+)?/gi, "");
  const unit = value.match(/\b(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|kilograms?|grams?|kilometers?|meters?|liters?|USD|EUR|GBP|percent)\b|[%$€£]/i)?.[0]
    .toLowerCase().replace(/s$/, "").replace("percent", "%");
  return { value, unit, scale: scale ? Number(scale[1]) : undefined };
}

export function isNumericCondition(quote: string, fact = "") {
  return numbers(quote).length > 0 || numbers(fact).length > 0 ||
    Object.values(comparisons).some(pattern => pattern.test(quote));
}

export function numericRule(quote: string): ((actual: number) => boolean) | undefined {
  if (/\b(?:prohibited|forbidden|disallowed|excluded|ineligible|not eligible|not allowed|cannot|may not|must not)\b/i.test(quote)) return;
  const text = measurement(quote).value
    .replace(/\bor (?:above|higher|more|older)\b/gi, "at least")
    .replace(/\bor (?:below|lower|less|younger)\b/gi, "at most");
  const limits = numbers(text);
  if (limits.length === 2 && /\bbetween\b[\s\S]*\band\b|\d\s*(?:to|through|[-–—])\s*\d/i.test(text)) {
    if (/\b(?:not|except|excluding|exclusive|strictly)\b/i.test(text)) return;
    const [lower, upper] = limits;
    if (lower <= upper) return actual => actual >= lower && actual <= upper;
    return;
  }
  const operators = (Object.keys(comparisons) as (keyof typeof comparisons)[])
    .filter(operator => comparisons[operator].test(text));
  if (limits.length === 1 && operators.length === 1) {
    const limit = limits[0];
    const operator = operators[0];
    return actual => ({
      at_least: actual >= limit, at_most: actual <= limit,
      greater_than: actual > limit, less_than: actual < limit, equals: actual === limit,
    })[operator];
  }
  const list = text.match(/\b\d+(?:\.\d+)?(?:\s*(?:,|\bor\b|\band\b)\s*\d+(?:\.\d+)?)+\b/i);
  if (!operators.length && limits.length >= 2 && list && /\b(?:one of|eligible|allowed|accepted|permitted|restricted to)\b/i.test(text) &&
      numbers(list[0]).length === limits.length) {
    return actual => limits.includes(actual);
  }
}

export function evaluateNumeric(quote: string, fact: string): "Pass" | "Fail" | "Uncertain" {
  const rule = numericRule(quote);
  const expected = measurement(quote);
  const actual = measurement(fact);
  const values = numbers(actual.value);
  const scaleMatches = actual.scale === undefined || actual.scale === expected.scale;
  if (!rule || values.length !== 1 || expected.unit !== actual.unit || !scaleMatches ||
      (expected.scale !== undefined && values[0] > expected.scale)) return "Uncertain";
  return rule(values[0]) ? "Pass" : "Fail";
}

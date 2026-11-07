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

const unitPattern = /\b(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|credits?|kilograms?|grams?|kilometers?|meters?|liters?|USD|EUR|GBP|percent)\b|[%$€£]/i;
const quantityStop = /^(?:at|of|the|and|or|to|for|a|an|no|not|per|out|than|least|most|above|below|over|under|between|exactly|equal|equals|minimum|maximum|up|with|from|into|by)$/;

function explicitQuantities(text: string) {
  const pattern = /(?<![\p{L}\p{N}.])(?:(USD|EUR|GBP|[$€£])\s*)?([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:[\s–—-]*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|credits?|kilograms?|grams?|kilometers?|meters?|liters?|USD|EUR|GBP|percent)\b|\s*(%))?(?![\p{L}\p{N}])/giu;
  const canonical = (unit: string) => ({"$": "usd", "€": "eur", "£": "gbp", percent: "%"}[unit.toLowerCase()] ?? unit.toLowerCase().replace(/s$/, ""));
  return [...text.matchAll(pattern)].flatMap(match => {
    const value = Number(match[2].replace(/,/g, ""));
    return [match[1], match[3], match[4]].filter(Boolean).map(unit => ({value, unit: canonical(unit)}));
  });
}

// A number appearing somewhere in a quote does not authorize changing its unit.
// Keep values coupled to explicit units; conversions fall back to the source wording.
export function supportsNumbersAndUnits(statement: string, quote: string) {
  if (!numbers(statement).every(value => numbers(quote).includes(value))) return false;
  const source = explicitQuantities(quote);
  return explicitQuantities(statement).every(quantity => source.some(item => item.value === quantity.value && item.unit === quantity.unit));
}

function measurement(text: string) {
  const scale = text.match(/(?:\bout of\s+|\/)(\d+(?:\.\d+)?)/i);
  const value = text.replace(/(?:\bout of\s+|\/)\d+(?:\.\d+)?/gi, "");
  const unit = value.match(unitPattern)?.[0]
    .toLowerCase().replace(/s$/, "").replace("percent", "%");
  return { value, unit, scale: scale ? Number(scale[1]) : undefined };
}

function quantityMarkers(text: string) {
  const markers = new Set<string>();
  const { unit } = measurement(text);
  if (unit) markers.add(unit);
  for (const match of text.matchAll(
    /(?<![\p{L}\p{N}])([\p{L}]{2,})(?:\s+of)?(?:\s*:)?\s*[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|(?:[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([\p{L}]{2,})(?![\p{L}\p{N}])/gu,
  )) {
    const raw = (match[1] ?? match[2] ?? "").toLowerCase();
    if (!raw || quantityStop.test(raw)) continue;
    markers.add(unitPattern.test(raw) ? raw.replace(/s$/, "").replace("percent", "%") : raw.replace(/s$/, ""));
  }
  return [...markers];
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

export function numericSignature(quote: string) {
  if (!numericRule(quote)) return;
  const {value, unit, scale} = measurement(quote);
  return JSON.stringify([Object.keys(comparisons).filter(key => comparisons[key as keyof typeof comparisons].test(value)), numbers(value), unit, scale]);
}

export function evaluateNumeric(quote: string, fact: string): "Pass" | "Fail" | "Uncertain" {
  const rule = numericRule(quote);
  const expected = measurement(quote);
  const actual = measurement(fact);
  const values = numbers(actual.value);
  const scaleMatches = actual.scale === undefined || actual.scale === expected.scale;
  const quoteMarkers = quantityMarkers(quote);
  const factMarkers = quantityMarkers(fact);
  // A labeled quantity in the fact must share a subject or unit with the rule.
  if (factMarkers.length && quoteMarkers.length && !factMarkers.some(marker => quoteMarkers.includes(marker))) {
    return "Uncertain";
  }
  if (!rule || values.length !== 1 || expected.unit !== actual.unit || !scaleMatches ||
      (expected.scale !== undefined && values[0] > expected.scale)) return "Uncertain";
  return rule(values[0]) ? "Pass" : "Fail";
}

const crypto = require('node:crypto');

const FACT_SLOTS = new Set([
  'project_name', 'project_number', 'client_name', 'provider_name',
  'project_location', 'service_location', 'client_address',
  'service_object', 'deliverable', 'coordinate_system',
  'service_quantity', 'staffing', 'threshold',
  'budget', 'fee', 'bid_amount', 'unit_price',
  'contract_duration', 'completion_deadline', 'milestone', 'payment_schedule',
  'service_scope', 'deliverable_scope', 'method',
]);

const FACT_KINDS = new Set(['location', 'object', 'workload', 'amount', 'schedule', 'service', 'name']);

function normalizeChineseDigits(value) {
  const digits = { 零: 0,〇: 0,一: 1,二: 2,两: 2,三: 3,四: 4,五: 5,六: 6,七: 7,八: 8,九: 9 };
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 };
  const input = String(value || '').replace(/[，,]/gu, '').trim();
  if (!input || !/[一二两三四五六七八九十百千万亿零〇]/u.test(input)) return input;
  return input.replace(/[零〇一二两三四五六七八九十百千万亿]+/gu, (part) => normalizeChineseNumberPart(part, digits, units));
}

function normalizeChineseNumberPart(input, digits, units) {
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of input) {
    if (Object.hasOwn(digits, char)) number = digits[char];
    else if (Object.hasOwn(units, char)) {
      const unit = units[char];
      if (unit >= 10000) {
        section += number;
        total += section * unit;
        section = 0;
      } else {
        section += (number || 1) * unit;
      }
      number = 0;
    }
  }
  const result = total + section + number;
  return result > 0 ? String(result) : input;
}

function normalizeQualifier(value) {
  return normalizeChineseDigits(String(value || ''))
    .normalize('NFKC')
    .replace(/[：:；;]/gu, '')
    .replace(/[“”"']/gu, '')
    .replace(/\s+/gu, '')
    .trim()
    .toLowerCase();
}

function canonicalFactKey({ kind, slot, qualifier = '' }) {
  if (!FACT_KINDS.has(kind)) throw new Error(`不支持的事实类型：${kind}`);
  if (!FACT_SLOTS.has(slot)) throw new Error(`不支持的事实槽位：${slot}`);
  return `${kind}:${slot}:${normalizeQualifier(qualifier)}`;
}

function stableHash(value) {
  const sortValue = (input) => {
    if (Array.isArray(input)) return input.map(sortValue);
    if (input && typeof input === 'object') {
      return Object.keys(input).sort().reduce((result, key) => {
        result[key] = sortValue(input[key]);
        return result;
      }, {});
    }
    return input;
  };
  return crypto.createHash('sha256').update(JSON.stringify(sortValue(value))).digest('hex');
}

function normalizeCandidate(candidate, nodeId) {
  const factKey = canonicalFactKey(candidate);
  const value = normalizeQualifier(candidate.value || candidate.canonical_value);
  const evidence = String(candidate.evidence || '').trim();
  if (!value || !evidence) throw new Error('事实候选缺少 value 或 evidence');
  return {
    fact_key: factKey,
    kind: candidate.kind,
    slot: candidate.slot,
    qualifier: normalizeQualifier(candidate.qualifier),
    canonical_value: String(candidate.value || candidate.canonical_value).trim(),
    normalized_value: value,
    evidence: [evidence],
    chapter_node_ids: nodeId ? [String(nodeId)] : [],
    conflict: false,
  };
}

function mergeFacts(candidates, { inputHash = '' } = {}) {
  const byKey = new Map();
  for (const input of Array.isArray(candidates) ? candidates : []) {
    const candidate = normalizeCandidate(input, input.node_id || input.nodeId);
    const current = byKey.get(candidate.fact_key);
    if (!current) {
      candidate.normalized_values = [candidate.normalized_value];
      byKey.set(candidate.fact_key, candidate);
      continue;
    }
    current.normalized_values = [...new Set([...(current.normalized_values || [current.normalized_value]), candidate.normalized_value])];
    current.conflict = current.conflict || current.normalized_value !== candidate.normalized_value;
    current.evidence = [...new Set([...current.evidence, ...candidate.evidence])];
    current.chapter_node_ids = [...new Set([...current.chapter_node_ids, ...candidate.chapter_node_ids])];
  }
  return [...byKey.values()].map((fact) => ({
    ...fact,
    fact_id: stableHash({ fact_key: fact.fact_key, input_hash: String(inputHash || '') }).slice(0, 24),
  }));
}

function factsHash(facts) {
  return stableHash((Array.isArray(facts) ? facts : []).map((fact) => ({
    fact_id: fact.fact_id,
    fact_key: fact.fact_key,
    normalized_value: fact.normalized_value,
    normalized_values: [...(Array.isArray(fact.normalized_values) ? fact.normalized_values : [fact.normalized_value])].sort(),
    chapter_node_ids: [...(fact.chapter_node_ids || [])].sort(),
    conflict: Boolean(fact.conflict),
  })).sort((left, right) => String(left.fact_key || left.fact_id || '').localeCompare(String(right.fact_key || right.fact_id || ''))));
}

module.exports = {
  FACT_KINDS,
  FACT_SLOTS,
  normalizeChineseDigits,
  normalizeQualifier,
  canonicalFactKey,
  normalizeCandidate,
  mergeFacts,
  factsHash,
  stableHash,
};

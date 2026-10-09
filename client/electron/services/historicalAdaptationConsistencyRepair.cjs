'use strict';

const crypto = require('node:crypto');

const FACT_KINDS = new Set(['location', 'object', 'workload', 'amount', 'schedule', 'service', 'name']);

function stableHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function hashContent(content) { return stableHash(String(content ?? '')); }

function asChapters(context) {
  if (Array.isArray(context?.chapters)) return context.chapters;
  if (context?.chapters && typeof context.chapters === 'object') return Object.entries(context.chapters).map(([node_id, value]) => ({ node_id, ...value }));
  return [];
}

function asFacts(context) { return Array.isArray(context?.facts) ? context.facts : []; }

function validFact(fact) {
  return Boolean(fact && typeof fact.fact_id === 'string' && fact.fact_id && FACT_KINDS.has(fact.kind)
    && typeof fact.canonical_value === 'string' && fact.canonical_value.trim()
    && Array.isArray(fact.evidence) && fact.evidence.length > 0 && fact.evidence.every((item) => typeof item === 'string' && item.trim())
    && Array.isArray(fact.chapter_node_ids) && fact.chapter_node_ids.length > 0
    && fact.chapter_node_ids.every((item) => typeof item === 'string' && item.trim())
    && new Set(fact.chapter_node_ids).size === fact.chapter_node_ids.length
    && typeof fact.conflict === 'boolean');
}

function validGroupShape(group) {
  return Boolean(group && typeof group.group_id === 'string' && group.group_id
    && typeof group.fact_id === 'string' && group.fact_id && typeof group.confidence === 'string'
    && typeof group.rationale === 'string' && group.rationale.trim()
    && typeof group.expected_content_hash === 'string' && typeof group.expected_inputs_hash === 'string' && typeof group.expected_facts_hash === 'string'
    && Array.isArray(group.chapters) && group.chapters.length > 0
    && group.chapters.every((chapter) => chapter && typeof chapter.node_id === 'string' && chapter.node_id
      && typeof chapter.expected_node_content_hash === 'string' && typeof chapter.expected_item_fingerprint === 'string'
      && typeof chapter.old_text === 'string' && typeof chapter.new_text === 'string'
      && Array.isArray(chapter.evidence) && chapter.evidence.length > 0 && chapter.evidence.every((item) => typeof item === 'string' && item.trim())));
}

function normalizeRepairResponse(response) {
  const groups = response?.repair_groups;
  if (!Array.isArray(groups)) throw new Error('repair response schema requires repair_groups');
  for (const group of groups) if (!validGroupShape(group)) throw new Error('repair group schema invalid');
  return { groups: groups.map((group) => ({ ...group, chapters: group.chapters.map((chapter) => ({ ...chapter })) })) };
}

function findFact(group, context) { return asFacts(context).find((fact) => fact.fact_id === group.fact_id); }

function validateRepairGroup(group, context = {}) {
  if (!validGroupShape(group)) return { ok: false, reason: 'repair-group-schema-invalid' };
  if (group.confidence !== 'high') return { ok: false, reason: 'confidence-not-high' };
  const fact = findFact(group, context);
  const semantic = context.semanticRepairFactIds?.has(group.fact_id) === true;
  if (!fact || !validFact(fact)) return { ok: false, reason: 'fact-schema-invalid' };
  if (fact.conflict) return { ok: false, reason: 'fact-conflict' };
  const expectedNodes = [...new Set(fact.chapter_node_ids.map(String))].sort();
  if (!semantic && new Set(group.chapters.map((chapter) => String(chapter.node_id))).size !== group.chapters.length) return { ok: false, reason: 'duplicate-node' };
  const actualNodes = [...new Set(group.chapters.map((chapter) => String(chapter.node_id)))].sort();
  if (semantic ? actualNodes.some((node) => !expectedNodes.includes(node))
    : expectedNodes.length !== actualNodes.length || expectedNodes.some((node, i) => node !== actualNodes[i])) return { ok: false, reason: 'chapter-coverage-incomplete' };
  const contentHash = context.expectedContentHash ?? context.contentHash ?? context.expected_content_hash;
  const inputsHash = context.expectedInputsHash ?? context.inputsHash ?? context.expected_inputs_hash;
  const factsHash = context.expectedFactsHash ?? context.factsHash ?? context.expected_facts_hash;
  if (typeof contentHash !== 'string' || !contentHash || group.expected_content_hash !== contentHash) return { ok: false, reason: 'content-hash-mismatch' };
  if (typeof inputsHash !== 'string' || !inputsHash || group.expected_inputs_hash !== inputsHash) return { ok: false, reason: 'inputs-hash-mismatch' };
  const acceptedFactsHashes = [factsHash, context.expectedLegacyFactsHash].filter(Boolean);
  if (!acceptedFactsHashes.includes(group.expected_facts_hash)) return { ok: false, reason: 'facts-hash-mismatch' };
  const chapters = asChapters(context);
  const byId = new Map(chapters.map((chapter) => [String(chapter.node_id), chapter]));
  for (const edit of group.chapters) {
    const chapter = byId.get(String(edit.node_id));
    if (!chapter) return { ok: false, reason: 'chapter-not-found' };
    if (chapter.content_origin === 'manual') return { ok: false, reason: 'manual-source' };
    if (chapter.confirmed_at) return { ok: false, reason: 'confirmed-source' };
    if (typeof chapter.item_fingerprint !== 'string' || !chapter.item_fingerprint || edit.expected_item_fingerprint !== chapter.item_fingerprint) return { ok: false, reason: 'item-fingerprint-mismatch' };
    if (edit.expected_node_content_hash !== hashContent(chapter.content)) return { ok: false, reason: 'node-content-hash-mismatch' };
  }
  const values = group.chapters.map((edit) => edit.new_text);
  if (!semantic && new Set(values).size !== 1) return { ok: false, reason: 'cross-chapter-value-mismatch' };
  return { ok: true, fact, chapters: byId };
}

function protectedMarkdownRanges(text) {
  const ranges = [];
  const fence = /```[\s\S]*?(?:```|$)/g;
  let match;
  while ((match = fence.exec(text))) ranges.push([match.index, match.index + match[0].length]);
  const linePattern = /(?:^\s*\|.*\|\s*$|<!--[\s\S]*?(?:-->|$)|<[^>]+>[\s\S]*?(?:<\/[^>]+>|$)|!\[[^\]]*\]\([^)]*\))/gm;
  while ((match = linePattern.exec(text))) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

function intersectsProtected(text, start, end) { return protectedMarkdownRanges(text).some(([a, b]) => start < b && end > a); }

function introducedTokens(oldText, newText) {
  const oldTokens = new Set(String(oldText).match(/[\p{L}\p{N}%￥$./:-]{2,}/gu) || []);
  return (String(newText).match(/[\p{L}\p{N}%￥$./:-]{2,}/gu) || []).filter((token) => !oldTokens.has(token));
}

function allowedTokens(fact, context) {
  const values = [fact.canonical_value, ...(fact.evidence || [])];
  const tokens = new Set();
  for (const value of values) for (const token of String(value || '').match(/[\p{L}\p{N}%￥$./:-]{2,}/gu) || []) tokens.add(token);
  return tokens;
}

function applyRepairGroup(group, context = {}) {
  const validation = validateRepairGroup(group, context);
  if (!validation.ok) return validation;
  const { fact, chapters: byId } = validation;
  const output = [];
  for (const edit of group.chapters) {
    const chapter = byId.get(String(edit.node_id));
    const content = String(chapter.content ?? '');
    if (!edit.old_text || !edit.new_text) return { ok: false, reason: 'empty-edit' };
    if (edit.old_text === edit.new_text) return { ok: false, reason: 'no-op-edit' };
    if (edit.old_text === content) return { ok: false, reason: 'whole-chapter-replacement' };
    const first = content.indexOf(edit.old_text);
    if (first < 0 || content.indexOf(edit.old_text, first + edit.old_text.length) >= 0) return { ok: false, reason: 'old-text-ambiguous' };
    if (intersectsProtected(content, first, first + edit.old_text.length) || /```/.test(edit.old_text) || /```/.test(edit.new_text)) return { ok: false, reason: 'markdown-protected' };
    if (!context.semanticRepairFactIds?.has(group.fact_id)) {
      const allowed = allowedTokens(fact, context);
      if (!/remove/i.test(edit.new_text) && !edit.new_text.includes(fact.canonical_value)) return { ok: false, reason: 'fact-token-not-allowed' };
      if (introducedTokens(edit.old_text, edit.new_text).some((token) => !allowed.has(token))) return { ok: false, reason: 'fact-token-not-allowed' };
    }
    const newContent = content.slice(0, first) + edit.new_text + content.slice(first + edit.old_text.length);
    output.push({ node_id: edit.node_id, content: newContent, new_content: newContent, old_content: content });
  }
  return { ok: true, group, chapters: output };
}

module.exports = { FACT_KINDS, stableHash, hashContent, normalizeRepairResponse, validateRepairGroup, applyRepairGroup };

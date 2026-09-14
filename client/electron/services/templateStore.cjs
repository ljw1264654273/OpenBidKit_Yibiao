const crypto = require('node:crypto');

const BUILT_IN_DEFAULT_TEMPLATE_ID = 'tpl-built-in-default';

function now() {
  return new Date().toISOString();
}

function createTemplateId() {
  return `tpl-${crypto.randomUUID()}`;
}

function resolveTemplateName(config) {
  return String(config?.template_name || '').trim() || '未命名模板';
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function templateFromRow(row) {
  if (!row) return null;
  return {
    template_id: row.template_id,
    template_name: row.template_name,
    config: JSON.parse(row.config_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createTemplateStore({ db }) {
  function insertTemplate(templateId, config, timestamp = now()) {
    const templateName = resolveTemplateName(config);
    const nextConfig = { ...config, template_name: templateName };

    db.prepare(`
      INSERT INTO export_templates (template_id, template_name, config_json, created_at, updated_at)
      VALUES (@template_id, @template_name, @config_json, @created_at, @updated_at)
    `).run({
      template_id: templateId,
      template_name: templateName,
      config_json: JSON.stringify(nextConfig),
      created_at: timestamp,
      updated_at: timestamp,
    });

    return {
      template_id: templateId,
      template_name: templateName,
      config: nextConfig,
      created_at: timestamp,
      updated_at: timestamp,
    };
  }

  function listTemplates() {
    return db.prepare(`
      SELECT template_id, template_name, config_json, created_at, updated_at
      FROM export_templates
      ORDER BY updated_at DESC, created_at DESC
    `).all().map(templateFromRow);
  }

  function getTemplate(templateId) {
    const row = db.prepare(`
      SELECT template_id, template_name, config_json, created_at, updated_at
      FROM export_templates
      WHERE template_id = ?
    `).get(templateId);
    return templateFromRow(row);
  }

  function createTemplate(config) {
    return insertTemplate(createTemplateId(), config);
  }

  function ensureBuiltInTemplate(config) {
    const seed = db.prepare(`
      SELECT seed_id
      FROM export_template_seeds
      WHERE seed_id = ?
    `).get(BUILT_IN_DEFAULT_TEMPLATE_ID);
    if (seed) {
      return getTemplate(BUILT_IN_DEFAULT_TEMPLATE_ID);
    }

    const normalizedConfig = { ...config, template_name: resolveTemplateName(config) };
    const configSignature = stableStringify(normalizedConfig);
    const existing = listTemplates().find((template) => stableStringify(template.config) === configSignature);
    if (existing) {
      db.prepare(`
        INSERT OR IGNORE INTO export_template_seeds (seed_id, seeded_at)
        VALUES (?, ?)
      `).run(BUILT_IN_DEFAULT_TEMPLATE_ID, now());
      return existing;
    }

    const template = insertTemplate(BUILT_IN_DEFAULT_TEMPLATE_ID, config);
    db.prepare(`
      INSERT OR IGNORE INTO export_template_seeds (seed_id, seeded_at)
      VALUES (?, ?)
    `).run(BUILT_IN_DEFAULT_TEMPLATE_ID, now());
    return template;
  }

  function updateTemplate(templateId, config) {
    const templateName = resolveTemplateName(config);
    const nextConfig = { ...config, template_name: templateName };
    const updatedAt = now();
    const row = db.prepare(`
      UPDATE export_templates
      SET template_name = @template_name,
          config_json = @config_json,
          updated_at = @updated_at
      WHERE template_id = @template_id
      RETURNING template_id, template_name, config_json, created_at, updated_at
    `).get({
      template_id: templateId,
      template_name: templateName,
      config_json: JSON.stringify(nextConfig),
      updated_at: updatedAt,
    });

    if (!row) {
      throw new Error('模板不存在或已被删除');
    }

    return templateFromRow(row);
  }

  function deleteTemplate(templateId) {
    const result = db.prepare('DELETE FROM export_templates WHERE template_id = ?').run(templateId);
    return {
      success: result.changes > 0,
      message: result.changes > 0 ? '模板已删除' : '模板不存在或已被删除',
    };
  }

  return {
    listTemplates,
    getTemplate,
    createTemplate,
    ensureBuiltInTemplate,
    updateTemplate,
    deleteTemplate,
  };
}

module.exports = {
  BUILT_IN_DEFAULT_TEMPLATE_ID,
  createTemplateStore,
};

const assert = require('node:assert/strict');
const test = require('node:test');

const { BUILT_IN_DEFAULT_TEMPLATE_ID, createTemplateStore } = require('./templateStore.cjs');

function createFakeDb() {
  const rows = new Map();
  const seeds = new Map();

  return {
    rows,
    seeds,
    prepare(sql) {
      if (sql.includes('FROM export_template_seeds')) {
        return {
          get: (seedId) => seeds.has(seedId) ? { seed_id: seedId } : undefined,
        };
      }

      if (sql.includes('ORDER BY updated_at DESC')) {
        return {
          all: () => [...rows.values()],
        };
      }

      if (sql.includes('DELETE FROM export_templates')) {
        return {
          run: (templateId) => ({ changes: rows.delete(templateId) ? 1 : 0 }),
        };
      }

      if (sql.includes('WHERE template_id = ?')) {
        return {
          get: (templateId) => rows.get(templateId),
        };
      }

      if (sql.includes('INSERT INTO export_templates')) {
        return {
          run: (params) => {
            rows.set(params.template_id, {
              template_id: params.template_id,
              template_name: params.template_name,
              config_json: params.config_json,
              created_at: params.created_at,
              updated_at: params.updated_at,
            });
          },
        };
      }

      if (sql.includes('INSERT OR IGNORE INTO export_template_seeds')) {
        return {
          run: (seedId, seededAt) => seeds.set(seedId, { seed_id: seedId, seeded_at: seededAt }),
        };
      }

      if (sql.includes('UPDATE export_templates')) {
        return {
          get: (params) => {
            const current = rows.get(params.template_id);
            if (!current) return undefined;
            const next = {
              ...current,
              template_name: params.template_name,
              config_json: params.config_json,
              updated_at: params.updated_at,
            };
            rows.set(params.template_id, next);
            return next;
          },
        };
      }

      throw new Error(`未处理的测试 SQL：${sql}`);
    },
  };
}

test('内置默认模板只初始化一次，用户删除后不会在下次启动自动恢复', () => {
  const db = createFakeDb();
  const store = createTemplateStore({ db });
  const config = { template_name: '默认模版', page: { paper_size: 'a4' } };

  const first = store.ensureBuiltInTemplate(config);
  const second = store.ensureBuiltInTemplate({ ...config, page: { paper_size: 'a3' } });

  assert.equal(first.template_id, BUILT_IN_DEFAULT_TEMPLATE_ID);
  assert.equal(second.template_id, BUILT_IN_DEFAULT_TEMPLATE_ID);
  assert.equal(store.listTemplates().length, 1);
  assert.equal(store.getTemplate(BUILT_IN_DEFAULT_TEMPLATE_ID).config.page.paper_size, 'a4');

  store.deleteTemplate(BUILT_IN_DEFAULT_TEMPLATE_ID);
  assert.equal(store.ensureBuiltInTemplate(config), null);
  assert.equal(store.listTemplates().length, 0);
});

// Выгрузка базы poehali через MCP проекта (только чтение) — для переезда на свой сервер.
//
//   node export_via_mcp.mjs <папка> schema   — структура: таблицы, ключи, индексы, связи
//   node export_via_mcp.mjs <папка> data     — данные пачками по 2000 строк
//   node export_via_mcp.mjs <папка> all
//
// Пароль MCP берётся из переменной MCP_AGENT_TOKEN и никуда не печатается.
// Таблицы с паспортами, паролями и токенами входа MCP намеренно не отдаёт —
// их программа пропускает: они скачиваются вручную на poehali.

import fs from 'node:fs';
import path from 'node:path';

const MCP_URL = 'https://functions.poehali.dev/9066944a-2bf6-4f4b-8dbd-3e938d87b96f';
const S = 't_p86119184_proektnaya_razrabotk';
const CHUNK = 2000;
const PARALLEL = 3;

// Переносятся вручную (личные данные) или не нужны (сессии входа: все войдут заново).
const SKIP = new Set([
  'users', 'suppliers', 'salary_payouts', 'personal_data',
  'auth_sessions', 'max_auth_sessions', 'telegram_auth_sessions',
  'max_login_codes', 'max_login_tokens', 'telegram_login_codes',
]);

const [, , OUT, MODE = 'all'] = process.argv;
if (!OUT) { console.error('Укажите папку для выгрузки'); process.exit(1); }
const TOKEN = process.env.MCP_AGENT_TOKEN;
if (!TOKEN) { console.error('Нет MCP_AGENT_TOKEN'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rpcId = 0;

async function query(sql) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0', id: ++rpcId, method: 'tools/call',
          params: { name: 'db_query', arguments: { sql, limit: 200 } },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.result.content[0].text;
      if (data.result.isError) throw new Error(text);
      const nl = text.indexOf('\n');
      if (text.slice(0, nl).includes('обрезано')) throw new Error('ответ обрезан: ' + text.slice(0, nl));
      return JSON.parse(text.slice(nl + 1));
    } catch (e) {
      if (attempt >= 6 || /Запрос не выполнился|закрыта|Разрешён только/.test(String(e.message))) throw e;
      await sleep(1500 * attempt);
    }
  }
}

// Любой список одной строкой: обходит ограничение в 200 строк на ответ.
// JSON приходит текстом (::text), чтобы большие числа и копейки не округлились по дороге.
async function queryRaw(sql) {
  const rows = await query(`SELECT coalesce(json_agg(x), '[]'::json)::text AS j FROM (${sql}) x`);
  return rows[0].j;
}

async function queryAll(sql) {
  return JSON.parse(await queryRaw(sql));
}

// ---------- структура ----------
//
// Прокси базы на poehali пускает только разрешённые функции (pg_get_expr,
// pg_get_constraintdef и т.п. запрещены), поэтому структура собирается из
// стандартных справочников information_schema и pg_indexes.

function columnType(c) {
  switch (c.data_type) {
    case 'character varying':
      return c.character_maximum_length ? `varchar(${c.character_maximum_length})` : 'varchar';
    case 'character':
      return `char(${c.character_maximum_length || 1})`;
    case 'numeric':
      if (c.numeric_precision == null) return 'numeric';
      return `numeric(${c.numeric_precision}, ${c.numeric_scale ?? 0})`;
    case 'timestamp without time zone':
    case 'timestamp with time zone':
    case 'time without time zone':
    case 'time with time zone': {
      const p = c.datetime_precision;
      if (p == null || Number(p) === 6) return c.data_type;
      return c.data_type.replace(/^(timestamp|time)/, `$1(${p})`);
    }
    case 'ARRAY':
      return `${c.udt_name.replace(/^_/, '')}[]`;
    case 'USER-DEFINED':
      return c.udt_name;
    default:
      return c.data_type;
  }
}

async function exportSchema() {
  const tables = await queryAll(`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = '${S}' AND table_type = 'BASE TABLE' ORDER BY 1`);
  const columns = await queryAll(`
    SELECT table_name AS tbl, ordinal_position AS pos, column_name AS col, data_type, udt_name,
           character_maximum_length, numeric_precision, numeric_scale, datetime_precision,
           is_nullable, column_default AS def, is_identity, identity_generation, is_generated, generation_expression
    FROM information_schema.columns WHERE table_schema = '${S}' ORDER BY table_name, ordinal_position`);
  const sequences = await queryAll(`
    SELECT sequencename AS name, data_type, start_value::text AS start_value, increment_by::text AS increment_by,
           min_value::text AS min_value, max_value::text AS max_value, cycle, last_value::text AS last_value
    FROM pg_sequences WHERE schemaname = '${S}' ORDER BY 1`);
  const keyCols = await queryAll(`
    SELECT constraint_name AS name, table_name AS tbl, column_name AS col, ordinal_position AS pos,
           position_in_unique_constraint AS upos
    FROM information_schema.key_column_usage WHERE constraint_schema = '${S}'
    ORDER BY constraint_name, ordinal_position`);
  const tcons = await queryAll(`
    SELECT constraint_name AS name, table_name AS tbl, constraint_type AS type
    FROM information_schema.table_constraints
    WHERE constraint_schema = '${S}' AND constraint_type IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY', 'CHECK')
      AND constraint_name NOT LIKE '%_not_null'`);
  // Внешние ключи — из pg_constraint: справочник referential_constraints прокси не пускает.
  const fks = await queryAll(`
    SELECT k.conname AS name, c.relname AS tbl, f.relname AS ftbl, k.conkey, k.confkey,
           k.confdeltype AS del, k.confupdtype AS upd, k.condeferrable AS deferrable, k.condeferred AS deferred
    FROM pg_constraint k JOIN pg_namespace n ON n.oid = k.connamespace
    JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class f ON f.oid = k.confrelid
    WHERE n.nspname = '${S}' AND k.contype = 'f'`);
  const attrs = await queryAll(`
    SELECT c.relname AS tbl, a.attnum AS num, a.attname AS col
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = '${S}' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`);
  const attName = new Map(attrs.map((a) => [`${a.tbl}.${a.num}`, a.col]));
  const checks = await queryAll(`
    SELECT c.constraint_name AS name, c.check_clause AS clause
    FROM information_schema.check_constraints c
    JOIN information_schema.table_constraints t
      ON t.constraint_schema = c.constraint_schema AND t.constraint_name = c.constraint_name
    WHERE c.constraint_schema = '${S}' AND t.constraint_type = 'CHECK' AND c.constraint_name NOT LIKE '%_not_null'`);
  const indexes = await queryAll(`
    SELECT indexname AS name, tablename AS tbl, indexdef AS def FROM pg_indexes WHERE schemaname = '${S}' ORDER BY 2, 1`);
  const enums = await queryAll(`
    SELECT t.typname AS name, json_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = '${S}' GROUP BY t.typname`);

  const counts = {};
  for (const t of tables) {
    if (SKIP.has(t.name)) continue;
    try {
      counts[t.name] = (await query(`SELECT count(*) AS n FROM ${S}.${quoteIdent(t.name)}`))[0].n;
    } catch (e) {
      counts[t.name] = `ошибка: ${e.message}`;
    }
  }

  const qt = (name) => `${S}.${quoteIdent(name)}`;
  const pre = [`CREATE SCHEMA IF NOT EXISTS ${S};`, `SET search_path = ${S}, public;`];
  for (const e of enums) pre.push(`CREATE TYPE ${qt(e.name)} AS ENUM (${e.labels.map(sqlStr).join(', ')});`);

  // Последовательности identity-колонок создаёт сама таблица, остальные — заранее.
  const identityCols = columns.filter((c) => c.is_identity === 'YES');
  const identitySeqNames = new Set(identityCols.map((c) => `${c.tbl}_${c.col}_seq`));
  for (const s of sequences) {
    if (identitySeqNames.has(s.name)) continue;
    pre.push(`CREATE SEQUENCE IF NOT EXISTS ${qt(s.name)} AS ${s.data_type} INCREMENT BY ${s.increment_by} ` +
      `MINVALUE ${s.min_value} MAXVALUE ${s.max_value} START WITH ${s.start_value}${s.cycle ? ' CYCLE' : ''};`);
  }

  const byTable = new Map();
  for (const c of columns) {
    if (!byTable.has(c.tbl)) byTable.set(c.tbl, []);
    byTable.get(c.tbl).push(c);
  }
  const generated = {};
  for (const t of tables) {
    const cols = (byTable.get(t.name) || []).map((c) => {
      let line = `  ${quoteIdent(c.col)} ${columnType(c)}`;
      if (c.is_identity === 'YES') line += ` GENERATED ${c.identity_generation} AS IDENTITY`;
      else if (c.is_generated === 'ALWAYS') {
        line += ` GENERATED ALWAYS AS (${c.generation_expression}) STORED`;
        (generated[t.name] ||= []).push(c.col);
      } else if (c.def != null) line += ` DEFAULT ${c.def}`;
      if (c.is_nullable === 'NO') line += ' NOT NULL';
      return line;
    });
    pre.push(`CREATE TABLE ${qt(t.name)} (\n${cols.join(',\n')}\n);`);
  }
  // Последовательность принадлежит колонке, чей DEFAULT её вызывает (как у serial).
  for (const c of columns) {
    const m = c.def && /^nextval\('(?:[^']*\.)?"?([^'"]+)"?'::regclass\)$/.exec(c.def);
    if (m && sequences.some((s) => s.name === m[1])) {
      pre.push(`ALTER SEQUENCE ${qt(m[1])} OWNED BY ${qt(c.tbl)}.${quoteIdent(c.col)};`);
    }
  }

  const colsOf = (name) => keyCols.filter((k) => k.name === name).sort((a, b) => a.pos - b.pos);
  const consNames = new Set(tcons.map((k) => k.name));
  const post = [`SET search_path = ${S}, public;`];
  const pk = {};
  const order = { 'PRIMARY KEY': 1, UNIQUE: 2, CHECK: 3, 'FOREIGN KEY': 4 };
  for (const k of [...tcons].sort((a, b) => order[a.type] - order[b.type] || a.tbl.localeCompare(b.tbl))) {
    const cols = colsOf(k.name);
    const list = cols.map((c) => quoteIdent(c.col)).join(', ');
    let def;
    if (k.type === 'PRIMARY KEY') {
      def = `PRIMARY KEY (${list})`;
      pk[k.tbl] = cols.map((c) => quoteIdent(c.col));
    } else if (k.type === 'UNIQUE') {
      def = `UNIQUE (${list})`;
    } else if (k.type === 'CHECK') {
      const ch = checks.find((c) => c.name === k.name);
      if (!ch) continue;
      def = `CHECK (${ch.clause})`;
    } else {
      const r = fks.find((x) => x.name === k.name && x.tbl === k.tbl);
      if (!r) continue;
      const rule = { a: null, r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
      const local = r.conkey.map((n) => quoteIdent(attName.get(`${r.tbl}.${n}`)));
      const remote = r.confkey.map((n) => quoteIdent(attName.get(`${r.ftbl}.${n}`)));
      def = `FOREIGN KEY (${local.join(', ')}) REFERENCES ${qt(r.ftbl)} (${remote.join(', ')})`;
      if (rule[r.upd]) def += ` ON UPDATE ${rule[r.upd]}`;
      if (rule[r.del]) def += ` ON DELETE ${rule[r.del]}`;
      if (r.deferrable) def += r.deferred ? ' DEFERRABLE INITIALLY DEFERRED' : ' DEFERRABLE';
    }
    post.push(`ALTER TABLE ${qt(k.tbl)} ADD CONSTRAINT ${quoteIdent(k.name)} ${def};`);
  }
  // Индексы, которые не созданы ограничениями PRIMARY KEY / UNIQUE.
  for (const i of indexes) if (!consNames.has(i.name)) post.push(`${i.def};`);
  for (const s of sequences) {
    if (s.last_value != null) post.push(`SELECT setval('${S}.${quoteIdent(s.name)}', ${s.last_value}, true);`);
  }

  fs.writeFileSync(path.join(OUT, 'schema_pre.sql'), pre.join('\n\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'schema_post.sql'), post.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
    exportedAt: new Date().toISOString(), tables: tables.map((t) => t.name), skipped: [...SKIP],
    counts, pk, generated,
  }, null, 2));
  console.log(`структура: таблиц ${tables.length}, колонок ${columns.length}, последовательностей ${sequences.length}, ` +
    `ограничений ${tcons.length}, индексов ${indexes.length}, типов ${enums.length}`);
}

function quoteIdent(name) {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

function sqlStr(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ---------- данные ----------

async function exportTable(name, pk, expected) {
  const dir = path.join(OUT, 'data', name);
  fs.mkdirSync(dir, { recursive: true });
  const T = `${S}.${quoteIdent(name)}`;
  let total = 0;
  let part = 0;
  const keyset = pk && pk.length === 1 ? pk[0] : null;
  const order = pk && pk.length ? pk.join(', ') : '1';
  let last = null;
  let offset = 0;
  for (;;) {
    let sql;
    if (keyset) {
      const where = last === null ? '' : `WHERE ${keyset} > ${typeof last === 'number' ? last : sqlStr(last)}`;
      sql = `SELECT * FROM ${T} ${where} ORDER BY ${keyset} LIMIT ${CHUNK}`;
    } else {
      sql = `SELECT * FROM ${T} ORDER BY ${order} LIMIT ${CHUNK} OFFSET ${offset}`;
    }
    const raw = await queryRaw(sql);
    const rows = JSON.parse(raw); // только чтобы посчитать строки и взять последний ключ
    if (!rows.length) break;
    part += 1;
    fs.writeFileSync(path.join(dir, String(part).padStart(5, '0') + '.json'), raw); // как отдала база
    total += rows.length;
    if (keyset) last = rows[rows.length - 1][keyset.replace(/"/g, '')];
    offset += rows.length;
    if (rows.length < CHUNK) break;
  }
  fs.writeFileSync(path.join(dir, '_done.json'), JSON.stringify({ rows: total, expected }));
  return total;
}

async function exportData() {
  const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'), 'utf8'));
  const queue = meta.tables.filter((t) => !SKIP.has(t));
  const report = [];
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const name = queue[i++];
      if (fs.existsSync(path.join(OUT, 'data', name, '_done.json'))) continue; // докачка после обрыва
      fs.rmSync(path.join(OUT, 'data', name), { recursive: true, force: true });
      try {
        const n = await exportTable(name, meta.pk[name], meta.counts[name]);
        const mark = n === Number(meta.counts[name]) ? '' : `  (было ${meta.counts[name]} при снятии структуры)`;
        console.log(`${name}: ${n}${mark}`);
      } catch (e) {
        report.push(`${name}: ${e.message}`);
        console.log(`${name}: ОШИБКА ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (report.length) console.log('\nНе выгрузились:\n' + report.join('\n'));
  else console.log('\nВсе таблицы выгружены.');
}

const started = Date.now();
if (MODE === 'schema' || MODE === 'all') await exportSchema();
if (MODE === 'data' || MODE === 'all') await exportData();
console.log(`готово за ${Math.round((Date.now() - started) / 1000)} с`);

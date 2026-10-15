/**
 * dsh-st-preset — Host 半：把 SillyTavern 聊天补全预设按「窗口（Session）」接进 DSH。
 *
 * - 预设文件：<presetsDir>/*.json（原样读 ST 导出，不改结构）
 * - 每窗口状态：<presetsDir>/state.json → { sessions: { <sessionId>: { presetId, enabled:{}, text:{} } } }
 * - 注入：agent/created 时在该 agent 作用域注册一个 system prompt section，
 *   文本在「每次模型步」组装时现算 → 工具调用轮同样带着预设。
 * - 面板数据：POST /api/st-preset（走 host connection 的精确 Fetch 路由，受 /api 鉴权保护）
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE = '/api/st-preset';
const SECTION_ORDER = 100;

export const inject = ['systemPrompt'];

export function apply(ctx, config) {
  const presetsDir = (config && config.presetsDir) || '/root/.dsh/st-presets';
  const statePath = join(presetsDir, 'state.json');

  let presets = new Map();   // id -> parsed ST preset
  let state = { sessions: {} };

  const readJson = (file) => {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
  };

  const loadPresets = () => {
    const next = new Map();
    try {
      mkdirSync(presetsDir, { recursive: true });
      for (const name of readdirSync(presetsDir)) {
        if (!name.endsWith('.json') || name === 'state.json') continue;
        const raw = readJson(join(presetsDir, name));
        if (!raw || typeof raw !== 'object') continue;
        const id = name.slice(0, -'.json'.length);
        const entries = orderOf(raw);
        next.set(id, {
          id,
          file: name,
          name: typeof raw.name === 'string' && raw.name ? raw.name : id,
          raw,
          order: entries,
          prompts: new Map((Array.isArray(raw.prompts) ? raw.prompts : []).map((p) => [p.identifier, p])),
        });
      }
    } catch (error) {
      ctx.logger?.warn?.(`st-preset: 读取预设目录失败：${error && error.message}`);
    }
    presets = next;
    return next;
  };

  const loadState = () => {
    const raw = readJson(statePath);
    state = raw && typeof raw === 'object' && raw.sessions && typeof raw.sessions === 'object'
      ? { sessions: raw.sessions }
      : { sessions: {} };
    return state;
  };

  const saveState = () => {
    try {
      mkdirSync(presetsDir, { recursive: true });
      const tmp = `${statePath}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      writeFileSync(statePath, readFileSync(tmp), { mode: 0o600 });
    } catch (error) {
      ctx.logger?.warn?.(`st-preset: 保存状态失败：${error && error.message}`);
    }
  };

  const windowState = (sessionId) => {
    const key = String(sessionId || '');
    state.sessions[key] ||= { presetId: null, enabled: {}, text: {} };
    return state.sessions[key];
  };

  // ---------------------------------------------------------------- ST 组装

  /** ST prompt_order 里的条目顺序；缺省时退回 prompts 自身顺序。 */
  function orderOf(preset) {
    const orders = preset && preset.prompt_order;
    if (Array.isArray(orders) && orders.length > 0) {
      const first = orders.find((o) => o && Array.isArray(o.order)) || orders[0];
      if (first && Array.isArray(first.order)) return first.order;
    }
    return null;
  }

  const SETVAR = /\{\{setvar::([^:{}]+?)::([\s\S]*?)\}\}/g;
  const GETVAR = /\{\{getvar::([^:{}]+?)\}\}/g;
  const COMMENT = /\{\{\/\/[\s\S]*?\}\}/g;
  const ANY_MACRO = /\{\{[\s\S]*?\}\}/g;

  function expand(text, vars) {
    let out = String(text ?? '');
    out = out.replace(COMMENT, '');
    for (let pass = 0; pass < 6; pass += 1) {
      let changed = false;
      out = out.replace(SETVAR, (_m, key, value) => {
        vars[String(key).trim()] = value;
        changed = true;
        return '';
      });
      out = out.replace(GETVAR, (_m, key) => {
        changed = true;
        return vars[String(key).trim()] ?? '';
      });
      if (!changed) break;
    }
    return out
      .replace(/\{\{trim\}\}/g, '')
      .replace(/\{\{user\}\}/g, '玩家')
      .replace(/\{\{char\}\}/g, '角色')
      .replace(ANY_MACRO, '');
  }

  /** 一个窗口当前生效的完整提示词文本。 */
  function compose(sessionId) {
    const win = state.sessions[String(sessionId || '')];
    const presetId = win && win.presetId;
    if (!presetId) return '';
    const preset = presets.get(presetId);
    if (!preset) return '';
    const overrides = win;
    const order = preset.order || [];
    const entries = order.length > 0
      ? order
      : [...preset.prompts.keys()].map((identifier) => ({ identifier, enabled: true }));
    const vars = {};
    const parts = [];
    for (const entry of entries) {
      const prompt = preset.prompts.get(entry.identifier);
      if (!prompt) continue;
      const enabled = (overrides.enabled && typeof overrides.enabled[entry.identifier] === 'boolean')
        ? overrides.enabled[entry.identifier]
        : entry.enabled !== false;
      if (!enabled) continue;
      const source = (overrides.text && typeof overrides.text[entry.identifier] === 'string')
        ? overrides.text[entry.identifier]
        : prompt.content;
      const text = expand(source, vars).trim();
      if (text) parts.push(text);
    }
    return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /** 面板用的预设视图：分区/分组信息一并给出，尽量还原 ST 的层级。 */
  function describe(presetId, sessionId) {
    const preset = presets.get(presetId);
    if (!preset) return null;
    const win = state.sessions[String(sessionId || '')] || { enabled: {}, text: {} };
    const order = preset.order || [];
    const source = order.length > 0
      ? order
      : [...preset.prompts.keys()].map((identifier) => ({ identifier, enabled: true }));
    let section = '未分区';
    const entries = [];
    for (const entry of source) {
      const prompt = preset.prompts.get(entry.identifier);
      if (!prompt) continue;
      const name = String(prompt.name || entry.identifier);
      const content = String(prompt.content || '');
      if (content.trim() === '') {
        // 空条目：📌 开头的当分区标题，其余（角色锚点/聊天记录占位）不上面板
        if (/^📌/.test(name)) section = name.replace(/[【】]/g, '').trim();
        continue;
      }
      if (prompt.marker) continue;
      const enabled = (win.enabled && typeof win.enabled[entry.identifier] === 'boolean')
        ? win.enabled[entry.identifier]
        : entry.enabled !== false;
      entries.push({
        identifier: entry.identifier,
        name,
        section,
        group: groupOf(name),
        role: prompt.role || 'system',
        enabled,
        edited: Boolean(win.text && typeof win.text[entry.identifier] === 'string'),
        chars: String((win.text && win.text[entry.identifier]) ?? prompt.content ?? '').length,
      });
    }
    return {
      id: preset.id,
      name: preset.name,
      file: preset.file,
      entries,
      activeChars: compose(sessionId).length,
    };
  }

  /** 🔀 多选一：按名字里表情/括号前的词组归组；其余条目各自独立。 */
  function groupOf(name) {
    const match = /^🔀\s*([^\s（(·]+)/.exec(name);
    return match ? `🔀${match[1]}` : null;
  }

  // ------------------------------------------------------------ 状态与接口

  const snapshot = (sessionId) => {
    const win = state.sessions[String(sessionId || '')] || { presetId: null };
    return {
      presetsDir,
      sessionId: sessionId || null,
      presetId: win.presetId || null,
      presets: [...presets.values()].map((p) => ({ id: p.id, name: p.name, file: p.file })),
      detail: win.presetId ? describe(win.presetId, sessionId) : null,
    };
  };

  /** 用预设自己的 name / 上传文件名推导安全 id；杜绝路径穿越。 */
  const presetIdOf = (fileName, parsed) => {
    const base = String(fileName || (parsed && parsed.name) || '').replace(/\\/g, '/').split('/').pop() || '';
    const raw = base.replace(/\.json$/i, '').trim() || String((parsed && parsed.name) || '').trim() || 'preset';
    const safe = raw.replace(/[\u0000-\u001f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 60);
    return safe || 'preset';
  };

  const looksLikeStPreset = (value) => Boolean(value) && typeof value === 'object'
    && Array.isArray(value.prompts) && value.prompts.length > 0;

  const handle = (payload) => {
    const action = String(payload && payload.action || '');
    const sessionId = payload && payload.sessionId;
    if (action === 'reload') {
      loadPresets();
      loadState();
      return snapshot(sessionId);
    }
    if (action === 'state') return snapshot(sessionId);
    if (action === 'setPreset') {
      const win = windowState(sessionId);
      win.presetId = payload.presetId || null;
      win.enabled = {};
      win.text = {};
      saveState();
      return snapshot(sessionId);
    }
    if (action === 'toggle') {
      const preset = presets.get(windowState(sessionId).presetId);
      const win = windowState(sessionId);
      if (preset) {
        win.enabled[String(payload.identifier)] = payload.enabled !== false;
        if (payload.enabled !== false && payload.exclusiveGroup) {
          for (const entry of preset.prompts.values()) {
            if (entry.identifier === payload.identifier) continue;
            if (groupOf(String(entry.name || '')) === payload.exclusiveGroup) win.enabled[entry.identifier] = false;
          }
        }
      }
      saveState();
      return snapshot(sessionId);
    }
    if (action === 'import') {
      let parsed;
      try {
        const raw = typeof payload.text === 'string' ? payload.text.replace(/^\uFEFF/, '') : payload.json;
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return { error: '不是合法 JSON' };
      }
      if (!looksLikeStPreset(parsed)) return { error: '不像 ST 聊天补全预设（缺 prompts 数组）' };
      const presetId = presetIdOf(payload.fileName, parsed);
      const target = join(presetsDir, `${presetId}.json`);
      if (existsSync(target) && payload.overwrite !== true) {
        return { conflict: presetId, message: `已存在「${presetId}」，要覆盖吗？` };
      }
      writeFileSync(target, `${JSON.stringify(parsed, null, 4)}\n`, { mode: 0o600 });
      loadPresets();
      const win = windowState(sessionId);
      if (payload.select !== false) { win.presetId = presetId; win.enabled = {}; win.text = {}; saveState(); }
      return { ...snapshot(sessionId), imported: presetId };
    }
    if (action === 'delete') {
      const presetId = String(payload.presetId || '');
      if (!presetId || presetId.includes('/') || presetId.includes('\\') || presetId.startsWith('.')) {
        return { error: '非法的预设 id' };
      }
      const target = join(presetsDir, `${presetId}.json`);
      if (!existsSync(target)) return { error: `找不到预设「${presetId}」` };
      unlinkSync(target);
      for (const win of Object.values(state.sessions)) if (win.presetId === presetId) win.presetId = null;
      saveState();
      loadPresets();
      return snapshot(sessionId);
    }
    if (action === 'clearOverrides') {
      const win = windowState(sessionId);
      win.enabled = {};
      win.text = {};
      saveState();
      return snapshot(sessionId);
    }
    return { error: `unknown action: ${action}` };
  };

  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.connection.registerFetchRoute(connectionCtx, {
      path: ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let payload;
        try { payload = JSON.parse(await request.text()); } catch { return json({ error: 'invalid json' }, 400); }
        try { return json(handle(payload)); } catch (error) {
          return json({ error: String(error && error.message || error) }, 500);
        }
      },
    });
  });

  // ------------------------------------------------- 每个窗口的提示词 section

  const disposers = new Map();

  ctx.on('agent/created', ({ agent }) => {
    const previous = disposers.get(agent.id);
    if (previous) { try { previous(); } catch { /* 已经释放 */ } }
    const owner = agent.ctx;
    const dispose = owner.effect(() => owner.systemPrompt.section({
      name: 'st-preset',
      order: SECTION_ORDER,
      interpolate: false,
      text: () => compose(agent.id),
    }), 'st-preset: window section');
    disposers.set(agent.id, dispose);
  });

  ctx.effect(() => () => {
    for (const dispose of disposers.values()) { try { dispose(); } catch { /* 已经释放 */ } }
    disposers.clear();
  }, 'st-preset: dispose window sections');

  loadPresets();
  loadState();
  ctx.logger?.info?.(`st-preset: ${presets.size} 个预设，目录 ${presetsDir}`);
}

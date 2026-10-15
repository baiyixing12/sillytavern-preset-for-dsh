/**
 * dsh-st-preset — Client 半：输入框左侧一个「预设」按钮，展开 ST 式条目面板。
 * 所有数据都走 POST /api/st-preset（Host 的精确 Fetch 路由，沿用 /api 鉴权）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-st-preset',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ROUTE = '/api/st-preset';

    let appCtx = null;

    const token = {
      panelBg: 'var(--dsw-alias-bg-overlay, rgba(30,30,33,0.98))',
      layer: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.16))',
      border: 'var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
      text: 'var(--dsw-alias-label-primary, inherit)',
      dim: 'var(--dsw-alias-label-caption, rgba(127,127,127,1))',
      brand: 'var(--dsw-alias-brand-primary, #4c8dff)',
    };

    const styles = {
      button: {
        display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px',
        fontSize: 12, color: token.text, background: 'transparent',
        border: `1px solid ${token.border}`, borderRadius: 999, cursor: 'pointer',
      },
      panel: {
        position: 'fixed', right: 12, bottom: 78, zIndex: 60,
        width: 'min(94vw, 430px)', maxHeight: '68vh', overflowY: 'auto',
        background: token.panelBg, color: token.text,
        border: `1px solid ${token.border}`, borderRadius: 12,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)', padding: '10px 12px',
        fontSize: 13, lineHeight: 1.5, backdropFilter: 'blur(6px)',
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', borderRadius: 8 },
      sectionTitle: { margin: '10px 0 4px', fontSize: 12, color: token.dim, letterSpacing: '0.02em' },
      chip: {
        fontSize: 10, padding: '1px 5px', borderRadius: 999,
        border: `1px solid ${token.border}`, color: token.dim, flex: '0 0 auto',
      },
      head: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
      select: {
        flex: '1 1 auto', minWidth: 0, height: 28, borderRadius: 8, fontSize: 12,
        color: token.text, background: token.layer, border: `1px solid ${token.border}`,
      },
      small: { fontSize: 11, color: token.dim },
      ghost: {
        height: 26, padding: '0 8px', fontSize: 12, cursor: 'pointer',
        color: token.text, background: token.layer,
        border: `1px solid ${token.border}`, borderRadius: 8,
      },
      note: { marginTop: 8, fontSize: 11, color: token.dim },
    };

    async function api(payload) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }

    function currentSessionId() {
      try {
        const snapshot = appCtx && appCtx.sessions && appCtx.sessions.list.getSnapshot();
        const rows = Object.values((snapshot && snapshot.byId) || {});
        const focused = rows.find((row) => ((row && row.retainedBy && row.retainedBy.mainView) || 0) > 0);
        return (focused && focused.id) || (rows[0] && rows[0].id) || null;
      } catch {
        return null;
      }
    }

    function Toggle({ checked, onClick, title }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false',
        title, onClick,
        style: {
          flex: '0 0 auto', width: 34, height: 20, borderRadius: 999, cursor: 'pointer', padding: 0,
          border: `1px solid ${checked ? token.brand : token.border}`,
          background: checked ? token.brand : 'transparent', position: 'relative',
        },
      }, h('span', {
        style: {
          position: 'absolute', top: 2, left: checked ? 16 : 2, width: 14, height: 14,
          borderRadius: '50%', background: checked ? '#fff' : token.dim, transition: 'left 120ms',
        },
      }));
    }

    function Panel({ onClose, inline }) {
      const [sessionId, setSessionId] = React.useState(currentSessionId());
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);

      const load = React.useCallback(async (action, extra) => {
        setBusy(true);
        try {
          const sid = currentSessionId();
          setSessionId(sid);
          const next = await api({ action: action || 'state', sessionId: sid, ...(extra || {}) });
          if (next && next.error) throw new Error(next.error);
          setData(next);
          setError('');
        } catch (cause) {
          setError(String((cause && cause.message) || cause));
        } finally {
          setBusy(false);
        }
      }, []);

      React.useEffect(() => { load('state'); }, [load]);
      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onClose]);

      const entries = (data && data.detail && data.detail.entries) || [];

      const shell = inline
        ? { ...styles.panel, position: 'static', right: 'auto', bottom: 'auto', width: '100%', maxHeight: 'none', boxShadow: 'none', margin: '0 0 12px' }
        : styles.panel;
      return h('div', { style: shell, role: inline ? undefined : 'dialog', 'aria-label': 'ST 预设' },
        h('div', { style: styles.head },
          h('select', {
            style: styles.select,
            value: (data && data.presetId) || '',
            onChange: (event) => load('setPreset', { presetId: event.target.value || null }),
          },
            h('option', { value: '' }, '（本窗口不使用预设）'),
            ...((data && data.presets) || []).map((preset) =>
              h('option', { key: preset.id, value: preset.id }, preset.name)),
          ),
          h('button', { style: styles.ghost, onClick: () => load('reload'), title: '重新扫描预设目录' }, '重载'),
          inline ? null : h('button', { style: styles.ghost, onClick: onClose, title: '关闭' }, '×'),
        ),
        data && data.presetId
          ? h('div', null,
              h('div', { style: styles.small },
                `${entries.filter((entry) => entry.enabled).length}/${entries.length} 条开启 · 生效 ${data.detail.activeChars} 字`,
              ),
              entries.map((entry, index) => {
                const header = index === 0 || entries[index - 1].section !== entry.section
                  ? h('div', { key: `s-${entry.section}-${index}`, style: styles.sectionTitle }, entry.section)
                  : null;
                const exclusive = entry.group ? { exclusiveGroup: entry.group } : {};
                return h(React.Fragment, { key: entry.identifier },
                  header,
                  h('div', { style: styles.row },
                    h(Toggle, {
                      checked: entry.enabled,
                      title: entry.enabled ? '关闭该条目' : '开启该条目',
                      onClick: () => load('toggle', {
                        identifier: entry.identifier,
                        enabled: !entry.enabled,
                        ...exclusive,
                      }),
                    }),
                    h('span', { style: { flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word' } },
                      entry.name,
                      entry.edited ? h('span', { style: { ...styles.chip, marginLeft: 6 } }, '已改') : null,
                    ),
                    entry.group ? h('span', { style: styles.chip }, '多选一') : null,
                    entry.role !== 'system' ? h('span', { style: styles.chip }, entry.role) : null,
                  ),
                );
              }),
              h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
                h('button', { style: styles.ghost, onClick: () => load('clearOverrides') }, '还原本窗口改动'),
                h('span', { style: { ...styles.small, alignSelf: 'center' } },
                  sessionId ? `仅窗口 ${String(sessionId).slice(0, 8)}` : '未识别窗口',
                ),
              ),
              h('div', { style: styles.note },
                '开关按窗口存；改动在下一次模型步（含工具调用轮）生效。',
              ),
            )
          : h('div', { style: styles.small }, '先选一个预设；预设文件放在 /root/.dsh/st-presets/*.json。'),
        error ? h('div', { style: { ...styles.small, color: 'var(--dsw-alias-label-primary-bluish, #ff8080)', marginTop: 8 } }, `接口出错：${error}`) : null,
        busy ? h('div', { style: styles.small }, '…') : null,
      );
    }

    function SettingsPage() {
      return h(Panel, { inline: true, onClose: () => {} });
    }

    function PresetButton() {
      const [open, setOpen] = React.useState(false);
      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          style: styles.button,
          title: 'ST 预设（按窗口）',
          onClick: () => setOpen((value) => !value),
        }, '预设'),
        open ? h(Panel, { onClose: () => setOpen(false) }) : null,
      );
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        appCtx = ctx;
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'st-preset',
          order: 40,
          label: () => 'ST 预设',
        }, PresetButton));
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'st-preset',
          order: 60,
          label: () => 'ST 预设',
        }, SettingsPage));
      },
    };
  },
});

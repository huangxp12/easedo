'use strict';

/* ============ 行级编辑器：Today 视图核心 ============ */

const Editor = (() => {
  const el = document.getElementById('editor');
  const hintEl = document.getElementById('editor-hint');

  let lines = [];            // {id, kind:'todo'|'head'|'text'|'empty'|'divider'|'note', indent, text, state, isNew}
  let dateStr = todayStr();
  let lastText = new Map();  // id -> 上次已记账文本（edited 事件基线）
  let openIds = new Map();   // id -> 最新已知文本（仅未完成任务，用于身份匹配）
  let pending = [];          // 待追加的快照事件
  let saveTimer = null;
  let booted = false;
  let trayOpen = false;      // 已完成折叠区是否展开
  const settled = new Set(); // 已收进折叠区的任务 id

  const norm = s => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  function genId() {
    const a = new Uint8Array(2);
    crypto.getRandomValues(a);
    return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function sim(a, b) {
    const na = norm(a), nb = norm(b);
    if (!na || !nb) return 0;
    let p = 0;
    const max = Math.min(na.length, nb.length);
    while (p < max && na[p] === nb[p]) p++;
    const lenR = 1 - Math.abs(na.length - nb.length) / Math.max(na.length, nb.length);
    return (p / max) * 0.7 + lenR * 0.3;
  }

  /* ---------- 解析与序列化 ---------- */

  function parseLines(text) {
    const out = [];
    for (const raw of text.split('\n')) {
      const s = raw.replace(/\r$/, '');
      const m = s.match(/^(\s*)- \[( |x|X)\] ?(.*)$/);
      if (m) {
        out.push({
          kind: 'todo',
          indent: Math.min(3, Math.floor(m[1].length / 2)),
          state: m[2].toLowerCase() === 'x' ? 'done' : 'open',
          text: m[3],
        });
      } else if (/^#{1,6}\s+\S/.test(s)) {
        out.push({ kind: 'head', text: s.replace(/^#{1,6}\s+/, '') });
      } else if (/^\s*-{2,}\s*$/.test(s)) {
        out.push({ kind: 'divider', text: '' });
      } else if (/^\s*>/.test(s)) {
        out.push({ kind: 'note', text: s.replace(/^\s*>\s?/, '') });
      } else if (s.trim() === '') {
        out.push({ kind: 'empty', text: '' });
      } else {
        out.push({ kind: 'text', text: s });
      }
    }
    return out;
  }

  function serialize() {
    return lines.map(ln => {
      if (ln.kind === 'todo') {
        return `${'  '.repeat(ln.indent)}- [${ln.state === 'done' ? 'x' : ' '}]${ln.text ? ' ' + ln.text : ''}`;
      }
      if (ln.kind === 'head') return `# ${ln.text}`;
      if (ln.kind === 'divider') return '---';
      if (ln.kind === 'note') return ln.text ? '> ' + ln.text : '>';
      if (ln.kind === 'empty') return '';
      return ln.text;
    }).join('\n');
  }

  /* ---------- 身份匹配（隐形 ID） ---------- */

  function rebuildOpenIds() {
    openIds.clear();
    for (const e of AppData.events) {
      if (!e || typeof e.id !== 'string') continue;
      const cur = openIds.get(e.id) || { text: '', state: 'open' };
      if (typeof e.text === 'string') cur.text = e.text;
      if (e.state === 'open' || e.state === 'done') cur.state = e.state;
      openIds.set(e.id, cur);
    }
    for (const [id, c] of [...openIds]) {
      if (c.state === 'done') openIds.delete(id);
    }
  }

  function assignIds() {
    const avail = new Map(openIds);
    for (const ln of lines) {
      if (ln.kind !== 'todo') { ln.id = null; continue; }
      const nt = norm(ln.text);
      let best = null;
      if (nt) {
        for (const [id, c] of avail) {
          if (norm(c.text) === nt) { best = id; break; }
        }
        if (!best && nt.length >= 2) {
          let bestScore = 0;
          for (const [id, c] of avail) {
            const s = sim(ln.text, c.text);
            if (s > bestScore) { bestScore = s; best = id; }
          }
          if (bestScore < 0.72) best = null;
        }
      }
      if (best) {
        ln.id = best;
        ln.isNew = false;
        avail.delete(best);
        lastText.set(best, openIds.get(best)?.text ?? '');
      } else {
        ln.id = genId();
        ln.isNew = true;
      }
    }
  }

  /* ---------- 快照事件 ---------- */

  function mkEv(type, ln, extra = {}) {
    const e = { id: ln.id, t: nowISO(), type, text: ln.text, ...extra };
    if (ln.kind === 'todo') e.state = ln.state;
    return e;
  }

  function parentOf(i) {
    const ln = lines[i];
    if (!ln || ln.kind !== 'todo' || ln.indent === 0) return null;
    for (let j = i - 1; j >= 0; j--) {
      const p = lines[j];
      if (p.kind === 'todo' && p.indent < ln.indent) return p.id;
    }
    return null;
  }

  /* ---------- 渲染 ---------- */

  function lineEl(ln, i) {
    const row = document.createElement('div');
    row.className = `line ${ln.kind}` + (ln.kind === 'todo' && ln.state === 'done' ? ' done' : '');
    row.dataset.i = i;
    if (ln.kind === 'todo' && ln.indent > 0) {
      row.style.marginLeft = (ln.indent * 26) + 'px';
    }
    if (ln.kind === 'todo') {
      const box = document.createElement('button');
      box.className = 'check';
      box.tabIndex = -1;
      box.title = '切换完成状态';
      box.innerHTML = '<svg viewBox="0 0 14 14"><polyline points="2.5 7.5 6 10.5 11.5 3.5"/></svg>';
      row.appendChild(box);
    } else if (ln.kind === 'head') {
      const hash = document.createElement('span');
      hash.className = 'hash';
      hash.textContent = '#';
      row.appendChild(hash);
    } else if (ln.kind === 'divider') {
      const rule = document.createElement('div');
      rule.className = 'rule';
      row.appendChild(rule);
    } else if (ln.kind === 'note') {
      const gt = document.createElement('span');
      gt.className = 'hash';
      gt.textContent = '>';
      row.appendChild(gt);
    }
    const txt = document.createElement('div');
    txt.className = 'txt';
    txt.contentEditable = 'plaintext-only';
    txt.spellcheck = false;
    txt.textContent = ln.text;
    row.appendChild(txt);
    return row;
  }

  /* ---------- 已完成折叠区：勾选 1 秒后收起，数据位置不变 ---------- */

  function inTray(ln) {
    return ln.kind === 'todo' && ln.state === 'done' && (trayOpen || settled.has(ln.id));
  }

  function trayBarEl(n) {
    const bar = document.createElement('div');
    bar.className = 'tray-bar' + (trayOpen ? ' open' : '');
    const tri = document.createElement('span');
    tri.className = 'tri';
    tri.textContent = trayOpen ? '▾' : '▸';
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = String(n);
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = trayOpen ? `已完成 ${n} · 点击收起` : `已完成 ${n} · 点击展开`;
    bar.append(tri, cnt, lbl);
    return bar;
  }

  function caretOffset(t) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const r = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(t);
    try { pre.setEnd(r.startContainer, r.startOffset); } catch { return 0; }
    return pre.toString().length;
  }

  function renderPreservingFocus() {
    const act = document.activeElement;
    let idx = null, off = 0;
    if (act && act.classList && act.classList.contains('txt')) {
      const row = act.closest('.line');
      if (row) { idx = +row.dataset.i; off = caretOffset(act); }
    }
    render();
    if (idx !== null && rowOf(idx)) focusLine(idx, 'start', off);
  }

  function settleNow(id) {
    if (settled.has(id)) return;
    const ln = lines.find(l => l.id === id);
    if (!ln || ln.kind !== 'todo' || ln.state !== 'done') return;
    const act = document.activeElement;
    const hadFocus = !!(act && act.classList && act.classList.contains('txt'));
    let idx = null, off = 0;
    if (hadFocus) {
      const row = act.closest('.line');
      if (row) { idx = +row.dataset.i; off = caretOffset(act); }
    }
    settled.add(id);
    render();
    if (idx !== null) {
      if (rowOf(idx)) focusLine(idx, 'start', off);
      else {
        /* 焦点所在行被收起：移到相邻的可见行，避免光标凭空消失 */
        let target = null;
        for (let j = idx + 1; j < lines.length && target === null; j++) if (!inTray(lines[j])) target = j;
        for (let j = idx - 1; j >= 0 && target === null; j--) if (!inTray(lines[j])) target = j;
        if (target !== null) focusLine(target, 'end');
      }
    }
  }

  function scheduleSettle(id) {
    if (!id) return;
    setTimeout(() => settleNow(id), 1000);
  }

  function render() {
    el.textContent = '';
    const frag = document.createDocumentFragment();
    const trayIdx = [];
    lines.forEach((ln, i) => {
      if (inTray(ln)) { trayIdx.push(i); return; }
      frag.appendChild(lineEl(ln, i));
    });
    if (trayIdx.length) {
      frag.appendChild(trayBarEl(trayIdx.length));
      if (trayOpen) trayIdx.forEach(i => frag.appendChild(lineEl(lines[i], i)));
    }
    el.appendChild(frag);
    updateProgress();
  }

  function rowOf(i) { return el.querySelector(`.line[data-i="${i}"]`); }
  function txtOf(i) { const r = rowOf(i); return r ? r.querySelector('.txt') : null; }

  function focusLine(i, where = 'end', offset = null) {
    const t = txtOf(i);
    if (!t) return;
    t.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    if (offset !== null) {
      let n = t.firstChild;
      while (n && offset > 0) {
        if (n.nodeType === 3) {
          const take = Math.min(offset, n.length);
          if (take === n.length) { offset -= take; n = n.nextSibling; } else { n = n.splitText(offset); offset = 0; }
        } else n = n.nextSibling;
      }
      if (n) range.setStart(n, Math.min(offset, n.length || 0));
      else range.selectNodeContents(t);
      range.collapse(true);
    } else if (where === 'start') {
      range.selectNodeContents(t); range.collapse(true);
    } else {
      range.selectNodeContents(t); range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function caretAtStart(t) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return false;
    if (r.startOffset !== 0) return false;
    let node = r.startContainer;
    while (node && node !== t) {
      if (node.previousSibling) return false;
      node = node.parentNode;
    }
    return true;
  }

  function caretAtEnd(t) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return false;
    const r = sel.getRangeAt(0);
    if (!r.collapsed) return false;
    let node = r.startContainer;
    let off = r.startOffset;
    while (node && node !== t) {
      if (node.nodeType === 3 && off < node.length) return false;
      if (node.nextSibling) return false;
      node = node.parentNode;
      off = 0;
    }
    return true;
  }

  function updateProgress() {
    const todos = lines.filter(l => l.kind === 'todo');
    const done = todos.filter(l => l.state === 'done').length;
    const head = document.getElementById('today-progress');
    if (!todos.length) { head.hidden = true; return; }
    head.hidden = false;
    document.getElementById('prog-num').textContent = `${done} / ${todos.length}`;
    document.getElementById('prog-fill').style.width = `${todos.length ? Math.round(done / todos.length * 100) : 0}%`;
  }

  /* ---------- 保存与落账 ---------- */

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 450);
  }

  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const batch = pending.slice();
    pending = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.kind !== 'todo' || !ln.id) continue;
      if (ln.isNew) {
        batch.push(mkEv('created', ln, { parent: parentOf(i), indent: ln.indent }));
        ln.isNew = false;
        lastText.set(ln.id, ln.text);
      } else if (norm(ln.text) !== norm(lastText.get(ln.id) ?? '')) {
        batch.push(mkEv('edited', ln, { parent: parentOf(i), indent: ln.indent }));
        lastText.set(ln.id, ln.text);
      }
    }
    const content = serialize();
    try {
      await Store.saveDay(dateStr, content);
      if (batch.length) {
        await Store.appendEvents(batch);
        AppData.events.push(...batch);
      }
    } catch (err) {
      pending.unshift(...batch);
      toast('保存失败：' + err);
    }
  }

  /* ---------- 编辑行为 ---------- */

  function insertAfter(i, kind, text = '') {
    const indent = kind === 'todo' && lines[i] && lines[i].kind === 'todo' ? lines[i].indent : 0;
    const ln = { id: kind === 'todo' ? genId() : null, kind, indent, text, state: 'open', isNew: kind === 'todo' };
    lines.splice(i + 1, 0, ln);
    return i + 1;
  }

  function removeLine(i) {
    const ln = lines[i];
    if (ln.kind === 'todo' && ln.id && !ln.isNew) pending.push(mkEv('deleted', ln));
    lines.splice(i, 1);
    if (!lines.length) lines.push({ id: genId(), kind: 'todo', indent: 0, text: '', state: 'open', isNew: true });
  }

  function onKeydown(e) {
    const row = e.target.closest('.line');
    if (!row) return;
    const i = +row.dataset.i;
    const ln = lines[i];
    const t = row.querySelector('.txt');

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const kind = ln.kind === 'todo' || ln.kind === 'divider' ? 'todo' : ln.kind === 'note' ? 'note' : 'text';
      const ni = insertAfter(i, kind);
      render();
      focusLine(ni, 'start');
      scheduleSave();
      return;
    }

    if (e.key === 'Tab' && ln.kind === 'todo') {
      e.preventDefault();
      ln.indent = Math.max(0, Math.min(3, ln.indent + (e.shiftKey ? -1 : 1)));
      render();
      focusLine(i, 'end');
      scheduleSave();
      return;
    }

    if (e.key === 'Backspace') {
      /* 光标在分割线内：整条删除，不依赖具体光标位置与选区 */
      if (ln.kind === 'divider') {
        e.preventDefault();
        removeLine(i);
        render();
        focusLine(Math.max(0, i - 1), 'end');
        scheduleSave();
        return;
      }
      if (!caretAtStart(t)) return;
      e.preventDefault();
      if (norm(ln.text) === '' && lines.length > 1) {
        removeLine(i);
        render();
        focusLine(Math.max(0, i - 1), 'end');
        scheduleSave();
      } else if (i > 0) {
        const prev = lines[i - 1];
        if (prev.kind === 'divider') {
          /* 行首退格：直接删掉上方分割线，本行内容与光标位置不变 */
          removeLine(i - 1);
          render();
          focusLine(i - 1, 'start', 0);
        } else if (prev.kind === 'todo') {
          const mergeAt = prev.text.length;
          prev.text += ln.text;
          removeLine(i);
          render();
          focusLine(i - 1, 'start', mergeAt);
        } else {
          prev.text += ln.text;
          removeLine(i);
          render();
          focusLine(i - 1, 'start', prev.text.length - ln.text.length);
        }
        scheduleSave();
      }
      return;
    }

    if (e.key === 'ArrowUp' && i > 0 && caretAtStart(t)) {
      e.preventDefault();
      focusLine(i - 1, 'end');
      return;
    }
    if (e.key === 'ArrowDown' && i < lines.length - 1 && caretAtEnd(t)) {
      e.preventDefault();
      focusLine(i + 1, 'start');
      return;
    }
    if (e.key === 'Escape') {
      flush();
      e.target.blur();
    }
  }

  function onInput(e) {
    const row = e.target.closest('.line');
    if (!row) return;
    const i = +row.dataset.i;
    const ln = lines[i];
    ln.text = e.target.textContent.replace(/\u00a0/g, ' ');
    if (ln.kind === 'empty' && ln.text !== '') ln.kind = 'text';
    if (ln.kind === 'head' && ln.text === '') ln.kind = 'text';
    if (ln.kind === 'divider' && ln.text !== '') ln.kind = 'text';
    if (ln.kind === 'note' && !/^>/.test(ln.text)) ln.kind = 'text';
    /* 行首输入 > 转为速记：无复选框、不计进度与快照 */
    if (ln.kind !== 'note' && /^>/.test(ln.text)) {
      if (ln.kind === 'todo' && ln.id && !ln.isNew) {
        pending.push({ id: ln.id, t: nowISO(), type: 'deleted', text: lastText.get(ln.id) ?? ln.text, state: ln.state });
      }
      ln.kind = 'note';
      ln.text = ln.text.replace(/^\s*>\s?/, '');
      ln.id = null;
      ln.isNew = false;
      render();
      focusLine(i, 'end');
      scheduleSave();
      return;
    }
    /* 速记 / 文本行输入 -[ 或 - [ ] 转回 todo（-[ 为快捷输入） */
    const todoM = ln.kind === 'note' || ln.kind === 'text' || ln.kind === 'empty'
      ? ln.text.match(/^\s*-\s?\[([xX ]?)\]?\s*(.*)$/)
      : null;
    if (todoM) {
      ln.kind = 'todo';
      ln.state = todoM[1].toLowerCase() === 'x' ? 'done' : 'open';
      ln.text = todoM[2];
      ln.id = genId();
      ln.isNew = true;
      render();
      focusLine(i, 'end');
      scheduleSave();
      if (ln.state === 'done') trayOpen ? settled.add(ln.id) : scheduleSettle(ln.id);
      return;
    }
    /* 整行只有短横线（-- 及以上）时转为分组分割线，并在下方续一行 */
    if (ln.kind !== 'divider' && /^\s*-{2,}\s*$/.test(ln.text)) {
      if (ln.kind === 'todo' && ln.id && !ln.isNew) {
        pending.push({ id: ln.id, t: nowISO(), type: 'deleted', text: lastText.get(ln.id) ?? ln.text, state: ln.state });
      }
      const nextKind = ln.kind === 'todo' ? 'todo' : 'text';
      ln.kind = 'divider';
      ln.text = '';
      ln.id = null;
      ln.isNew = false;
      insertAfter(i, nextKind);
      render();
      focusLine(i + 1, 'start');
      scheduleSave();
      return;
    }
    row.className = `line ${ln.kind}` + (ln.kind === 'todo' && ln.state === 'done' ? ' done' : '');
    updateProgress();
    scheduleSave();
  }

  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text) return;
    const row = e.target.closest('.line');
    if (!row) return;
    const i = +row.dataset.i;
    const ln = lines[i];
    const sel = window.getSelection();
    const parts = text.replace(/\r/g, '').split('\n');
    const t = row.querySelector('.txt');
    if (parts.length === 1) {
      document.execCommand('insertText', false, text);
      ln.text = t.textContent.replace(/\u00a0/g, ' ');
    } else {
      document.execCommand('insertText', false, parts[0]);
      ln.text = t.textContent.replace(/\u00a0/g, ' ');
      let at = i;
      for (let k = 1; k < parts.length; k++) {
        const p = parts[k];
        if (/^\s*-{2,}\s*$/.test(p)) { at = insertAfter(at, 'divider'); continue; }
        const nm = p.match(/^\s*>\s?(.*)$/);
        if (nm) { at = insertAfter(at, 'note', nm[1]); continue; }
        const tm = p.match(/^\s*-\s?\[([xX ]?)\]?\s*(.*)$/);
        if (tm) {
          at = insertAfter(at, 'todo', tm[2]);
          lines[at].state = tm[1].toLowerCase() === 'x' ? 'done' : 'open';
          if (lines[at].state === 'done') scheduleSettle(lines[at].id);
          continue;
        }
        at = insertAfter(at, ln.kind === 'todo' ? 'todo' : 'text', p);
      }
      render();
      focusLine(at, 'end');
    }
    scheduleSave();
  }

  function onClick(e) {
    const bar = e.target.closest('.tray-bar');
    if (bar) { trayOpen = !trayOpen; renderPreservingFocus(); return; }
    const check = e.target.closest('.check');
    if (!check) {
      const row = e.target.closest('.line');
      if (row && row.classList.contains('divider')) focusLine(+row.dataset.i, 'end');
      return;
    }
    const row = check.closest('.line');
    const i = +row.dataset.i;
    const ln = lines[i];
    if (ln.state === 'open') {
      ln.state = 'done';
      pending.push(mkEv('checked', ln, { parent: parentOf(i), indent: ln.indent }));
      flush();
      render();
      focusLine(i, 'end');
      if (trayOpen) settled.add(ln.id); else scheduleSettle(ln.id);
    } else {
      ln.state = 'open';
      settled.delete(ln.id);
      pending.push(mkEv('unchecked', ln, { parent: parentOf(i), indent: ln.indent }));
      flush();
      render();
      focusLine(i, 'end');
    }
  }

  /* ---------- 每日翻页：跨零点自动切到新一天 ---------- */

  let rolling = false;
  setInterval(async () => {
    if (!booted || rolling) return;
    const t = todayStr();
    if (t === dateStr) return;
    rolling = true;
    try { await loadDay(t, false); } catch { /* 翻页失败下次重试 */ } finally { rolling = false; }
  }, 30000);

  /* ---------- 往日未完成：识别 + 右键导入 ---------- */

  function openTasks() {
    const byId = new Map(); // id -> {text,state,indent,lastT,lastType}
    for (const e of AppData.events) {
      if (!e || typeof e.id !== 'string') continue;
      let rec = byId.get(e.id);
      if (!rec) { rec = { text: '', state: 'open', indent: 0, lastT: '', lastType: '' }; byId.set(e.id, rec); }
      if (typeof e.text === 'string' && e.type !== 'deleted') rec.text = e.text;
      if (e.state === 'open' || e.state === 'done') rec.state = e.state;
      if (typeof e.indent === 'number') rec.indent = e.indent;
      if (e.type) rec.lastType = e.type;
      if (e.t && e.t > rec.lastT) rec.lastT = e.t;
    }
    const curIds = new Set(lines.filter(l => l.kind === 'todo' && l.id).map(l => l.id));
    const out = [];
    for (const [id, r] of byId) {
      if (r.state !== 'open') continue;          // 已完成的不导入
      if (r.lastType === 'deleted') continue;    // 已删除的不导入
      if (curIds.has(id)) continue;              // 已在今天的跳过
      if (!r.text) continue;
      out.push({ id, text: r.text, indent: r.indent, lastT: r.lastT });
    }
    out.sort((a, b) => b.lastT.localeCompare(a.lastT));
    return out;
  }

  const ctx = document.createElement('div');
  ctx.className = 'ctx-menu';
  ctx.hidden = true;
  document.body.appendChild(ctx);
  const closeCtx = () => { ctx.hidden = true; };
  window.addEventListener('mousedown', e => { if (!ctx.hidden && !ctx.contains(e.target)) closeCtx(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtx(); });

  function showCtx(x, y) {
    ctx.textContent = '';
    const opens = openTasks();
    const b = document.createElement('button');
    b.className = 'ctx-item' + (opens.length ? '' : ' disabled');
    b.innerHTML = `导入往日未完成…<span class="ctx-cnt">${opens.length || '无'}</span>`;
    if (opens.length) b.addEventListener('click', () => { closeCtx(); showImport(opens); });
    ctx.appendChild(b);
    ctx.hidden = false;
    const r = ctx.getBoundingClientRect();
    ctx.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 10)) + 'px';
    ctx.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 10)) + 'px';
  }

  function showImport(opens) {
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    const picked = new Set();
    const groups = new Map();
    for (const t of opens) {
      const d = dayKey(t.lastT) || t.lastT.slice(0, 10);
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(t);
    }
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-label="导入往日未完成">
        <div class="modal-head"><b>导入往日未完成</b><span class="modal-sub">沿用原任务身份：Trace 里仍是同一条任务的一生，报告不计为新创建</span></div>
        <div class="modal-body"></div>
        <div class="modal-foot">
          <span class="modal-note"></span>
          <button class="btn ghost" id="imp-cancel">取消</button>
          <button class="btn primary" id="imp-ok" disabled>导入</button>
        </div>
      </div>`;
    const body = ov.querySelector('.modal-body');
    const okBtn = ov.querySelector('#imp-ok');
    const noteEl = ov.querySelector('.modal-note');
    for (const [d, items] of groups) {
      const g = document.createElement('div');
      g.className = 'imp-group';
      const gt = document.createElement('div');
      gt.className = 'imp-date';
      gt.textContent = d;
      g.appendChild(gt);
      for (const it of items) {
        const lab = document.createElement('label');
        lab.className = 'imp-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        const tx = document.createElement('span');
        tx.className = 'imp-text';
        tx.textContent = it.text;
        const tm = document.createElement('span');
        tm.className = 'imp-time';
        tm.textContent = hhmm(it.lastT);
        lab.append(cb, tx, tm);
        cb.addEventListener('change', () => {
          if (cb.checked) picked.add(it.id); else picked.delete(it.id);
          lab.classList.toggle('picked', cb.checked);
          okBtn.disabled = !picked.size;
          okBtn.textContent = picked.size ? `导入所选 ${picked.size} 项` : '导入';
          noteEl.textContent = picked.size ? '' : '勾选要带回今天的任务';
        });
        g.appendChild(lab);
      }
      body.appendChild(g);
    }
    ov.querySelector('#imp-cancel').addEventListener('click', () => ov.remove());
    ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });
    okBtn.addEventListener('click', () => {
      const items = opens.filter(t => picked.has(t.id));
      if (!items.length) return;
      if (lines.length === 1 && lines[0].kind === 'todo' && lines[0].isNew && !lines[0].text) lines = [];
      const at = lines.length;
      for (const it of items) {
        const ind = Math.min(3, it.indent || 0);
        lines.push({ id: it.id, kind: 'todo', indent: ind, text: it.text, state: 'open', isNew: false });
        lastText.set(it.id, it.text);
        pending.push({ id: it.id, t: nowISO(), type: 'imported', text: it.text, state: 'open', from: it.lastT.slice(0, 10), indent: ind });
      }
      render();
      focusLine(at, 'end');
      flush();
      ov.remove();
      toast(`已导入 ${items.length} 项未完成任务`);
    });
    document.body.appendChild(ov);
  }

  /* ---------- 对外接口 ---------- */

  function boot(allEvents) {
    AppData.events = allEvents || [];
    rebuildOpenIds();
    booted = true;
  }

  async function loadDay(date, focus = true) {
    if (!booted) return;
    await flush();
    dateStr = date;
    const res = await Store.loadDay(date);
    const content = res.content;
    lines = content ? parseLines(content) : [{ id: genId(), kind: 'todo', indent: 0, text: '', state: 'open', isNew: true }];
    rebuildOpenIds();
    assignIds();
    settled.clear();
    for (const ln of lines) if (ln.kind === 'todo' && ln.state === 'done' && ln.id) settled.add(ln.id);
    trayOpen = false;
    render();
    const h = dateHeading(date);
    document.getElementById('date-big').textContent = h.big;
    document.getElementById('date-sub').textContent = h.sub;
    if (focus) focusLine(0, 'end');
  }

  el.addEventListener('keydown', onKeydown);
  el.addEventListener('input', onInput);
  el.addEventListener('paste', onPaste);
  el.addEventListener('click', onClick);
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    showCtx(e.clientX, e.clientY);
  });
  window.addEventListener('beforeunload', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  return { boot, loadDay, flush };
})();

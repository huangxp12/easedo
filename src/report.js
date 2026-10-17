'use strict';

/* ============ 周报 / 月报：从快照汇总，导出 MD + HTML ============ */

const Report = (() => {
  const ACCENT = '#4c6ef5', GOOD = '#1f9d61', INK = '#1e2228', MUTED = '#78808c', LINE = '#e6e9ee';

  function rangeStr(a, b) {
    const [, am, ad] = a.split('-').map(Number);
    const [, bm, bd] = b.split('-').map(Number);
    return `${am}月${ad}日 – ${bm}月${bd}日`;
  }

  function buildTasks() {
    const byId = new Map();
    for (const e of AppData.events) {
      if (!e || typeof e.id !== 'string') continue;
      let t = byId.get(e.id);
      if (!t) { t = { id: e.id, events: [], text: '', state: 'open', createdT: null, doneT: null }; byId.set(e.id, t); }
      t.events.push(e);
      if (typeof e.text === 'string' && e.type !== 'deleted') t.text = e.text;
      if (e.state === 'open' || e.state === 'done') t.state = e.state;
      if (e.type === 'created' && !t.createdT) t.createdT = e.t;
      if (e.type === 'checked' && !t.doneT) t.doneT = e.t;
    }
    return byId;
  }

  function periodData(start, end) {
    const inWin = t => { const k = dayKey(t); return !!k && k >= start && k <= end; };
    const byId = buildTasks();
    const created = [], done = [], open = [];
    for (const t of byId.values()) {
      const born = t.createdT && inWin(t.createdT);
      const doneInWin = t.doneT && inWin(t.doneT) && t.state === 'done';
      const touched = t.events.some(e => inWin(e.t));
      if (born) created.push(t);
      if (doneInWin) done.push(t);
      else if (t.state !== 'done' && touched) open.push(t);
    }
    const dur = t => {
      const ms = new Date(t.doneT) - new Date(t.createdT);
      if (!(ms > 0)) return '';
      const h = Math.floor(ms / 3600000), m = Math.round(ms % 3600000 / 60000);
      return h ? `${h}h${m}m` : `${m}m`;
    };
    const rate = (done.length + open.length) ? Math.round(done.length / (done.length + open.length) * 100) : 0;
    return { start, end, created, done, open, dur, rate };
  }

  function mdEscape(s) { return (s || '').replace(/\|/g, '\\|'); }

  function buildMarkdown(title, d) {
    const L = [];
    L.push(`# ${title}`, '');
    L.push(`> 区间：${rangeStr(d.start, d.end)}　·　生成于 ${nowISO().replace('T', ' ')}`, '');
    L.push('## 概览', '');
    L.push(`- 新建任务 **${d.created.length}** 项`);
    L.push(`- 完成任务 **${d.done.length}** 项`);
    L.push(`- 完成率 **${d.rate}%**`);
    L.push(`- 进行中 **${d.open.length}** 项`, '');
    L.push('## 完成的任务', '');
    if (d.done.length) {
      L.push('| 任务 | 创建 | 完成 | 耗时 |', '|---|---|---|---|');
      for (const t of d.done) {
        L.push(`| ${mdEscape(t.text)} | ${t.createdT ? t.createdT.slice(5, 16) : '—'} | ${t.doneT ? t.doneT.slice(5, 16) : '—'} | ${d.dur(t) || '—'} |`);
      }
    } else {
      L.push('（本区间无完成任务）');
    }
    L.push('', '## 进行中', '');
    if (d.open.length) {
      for (const t of d.open) L.push(`- ${mdEscape(t.text)}${t.createdT ? `（创建于 ${t.createdT.slice(0, 10)}）` : ''}`);
    } else {
      L.push('（无）');
    }
    L.push('');
    return L.join('\n');
  }

  function buildHTML(title, d) {
    const rows = d.done.map(t => `
      <tr><td>${esc(t.text)}</td><td class="num">${t.createdT ? t.createdT.slice(5, 16) : '—'}</td><td class="num">${t.doneT ? t.doneT.slice(5, 16) : '—'}</td><td class="num">${d.dur(t) || '—'}</td></tr>`).join('');
    const opens = d.open.map(t => `<li>${esc(t.text)}${t.createdT ? `<span class="when">创建于 ${t.createdT.slice(0, 10)}</span>` : ''}</li>`).join('');
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:${INK};max-width:720px;margin:40px auto;padding:0 24px;line-height:1.7}
h1{font-size:24px;margin-bottom:4px}
.sub{color:${MUTED};font-size:13px;margin-bottom:28px}
.stats{display:flex;gap:14px;margin-bottom:30px;flex-wrap:wrap}
.stat{border:1px solid ${LINE};border-radius:12px;padding:14px 22px;min-width:110px}
.stat .v{font-size:24px;font-weight:700;color:${ACCENT}}
.stat.g .v{color:${GOOD}}
.stat .k{font-size:12px;color:${MUTED};margin-top:2px}
h2{font-size:16px;margin:26px 0 10px}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{border-bottom:1px solid ${LINE};padding:9px 10px;text-align:left}
th{color:${MUTED};font-weight:600;font-size:12px}
td.num{font-variant-numeric:tabular-nums;color:${MUTED};white-space:nowrap}
ul{padding-left:20px;font-size:13.5px}
li{margin:5px 0}
.when{color:${MUTED};font-size:12px;margin-left:8px}
.empty{color:${MUTED};font-size:13px}
@media print{body{margin:10mm}}
</style></head><body>
<h1>${esc(title)}</h1>
<div class="sub">区间：${rangeStr(d.start, d.end)} · 生成于 ${nowISO().replace('T', ' ')}</div>
<div class="stats">
  <div class="stat"><div class="v">${d.created.length}</div><div class="k">新建任务</div></div>
  <div class="stat g"><div class="v">${d.done.length}</div><div class="k">完成任务</div></div>
  <div class="stat g"><div class="v">${d.rate}%</div><div class="k">完成率</div></div>
  <div class="stat"><div class="v">${d.open.length}</div><div class="k">进行中</div></div>
</div>
<h2>完成的任务</h2>
${d.done.length ? `<table><tr><th>任务</th><th>创建</th><th>完成</th><th>耗时</th></tr>${rows}</table>` : '<p class="empty">本区间无完成任务</p>'}
<h2>进行中</h2>
${d.open.length ? `<ul>${opens}</ul>` : '<p class="empty">无</p>'}
</body></html>`;
  }

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function generate(kind) {
    const now = bizNow();
    let start, end, title, fname;
    if (kind === 'week') {
      const m = mondayOf(now);
      const e = new Date(m); e.setDate(m.getDate() + 6);
      start = todayStrOffset(m); end = todayStrOffset(e);
      const w = isoWeek(now);
      title = `TodayTrace 周报 · ${w.year} 年第 ${w.week} 周`;
      fname = `周报_${w.year}-W${String(w.week).padStart(2, '0')}`;
    } else {
      start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end = todayStrOffset(e);
      title = `TodayTrace 月报 · ${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
      fname = `月报_${start.slice(0, 7)}`;
    }
    const d = periodData(start, end);
    const md = buildMarkdown(title, d);
    const html = buildHTML(title, d);
    const p1 = await Store.saveFile(`export/${fname}.md`, md);
    const p2 = await Store.saveFile(`export/${fname}.html`, html);
    return { d, md, p1, p2, title };
  }

  function todayStrOffset(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function showResult(res) {
    const box = document.getElementById('report-result');
    box.innerHTML = `
      <div class="saved">
        <b>✓ ${esc(res.title)} 已导出</b> — 新建 ${res.d.created.length} · 完成 ${res.d.done.length} · 完成率 ${res.d.rate}%<br>
        <code>${esc(res.p1)}</code><br><code>${esc(res.p2)}</code>
      </div>`;
  }

  function bindButtons() {
    const bw = document.getElementById('btn-week');
    const bm = document.getElementById('btn-month');
    const now = bizNow();
    const m = mondayOf(now);
    const e = new Date(m); e.setDate(m.getDate() + 6);
    document.getElementById('week-range').textContent = rangeStr(fmt(m), fmt(e));
    document.getElementById('month-range').textContent = rangeStr(fmt(new Date(now.getFullYear(), now.getMonth(), 1)), fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    async function run(btn, kind) {
      btn.disabled = true;
      try {
        const res = await generate(kind);
        showResult(res);
        toast(`<b>已导出</b> Markdown 与 HTML 至 export 目录`);
      } catch (err) {
        toast('导出失败：' + err);
      }
      btn.disabled = false;
    }
    bw.addEventListener('click', () => run(bw, 'week'));
    bm.addEventListener('click', () => run(bm, 'month'));
    function fmt(d) { return Report.fmt(d); }
  }

  return { bindButtons, fmt: todayStrOffset };
})();

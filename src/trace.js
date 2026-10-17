'use strict';

/* ============ Trace 视图：按天回看任务一生 ============ */

const Trace = (() => {
  const daylistEl = document.getElementById('trace-daylist');
  const detailEl = document.getElementById('trace-detail');

  const TYPE_CN = { created: '创建', edited: '修改', checked: '完成', unchecked: '重开', deleted: '删除', imported: '导入' };
  let days = [];
  let selected = null;

  function collectTasks() {
    const byId = new Map();
    for (const e of AppData.events) {
      if (!e || typeof e.id !== 'string') continue;
      let t = byId.get(e.id);
      if (!t) { t = { id: e.id, events: [] }; byId.set(e.id, t); }
      t.events.push(e);
      if (typeof e.text === 'string' && e.type !== 'deleted') t.text = e.text;
      if (e.state === 'open' || e.state === 'done') t.state = e.state;
    }
    return byId;
  }

  function tasksOfDay(date, byId) {
    const res = [];
    for (const t of byId.values()) {
      const todays = t.events.filter(e => dayKey(e.t) === date);
      if (!todays.length) continue;
      res.push({ t, todays });
    }
    res.sort((a, b) => (a.todays[0].t || '') < (b.todays[0].t || '') ? -1 : 1);
    return res;
  }

  function taskMeta(t, date) {
    const created = t.events.find(e => e.type === 'created');
    const doneEv = t.events.find(e => e.type === 'checked');
    const parts = [];
    if (created && created.t && dayKey(created.t) === date) parts.push(`创建于 ${hhmm(created.t)}`);
    if (doneEv && doneEv.t) {
      parts.push(`完成于 ${hhmm(doneEv.t)}`);
      if (created && created.t) {
        const ms = new Date(doneEv.t) - new Date(created.t);
        if (ms > 0) {
          const h = Math.floor(ms / 3600000), m = Math.round(ms % 3600000 / 60000);
          parts.push(`耗时 <b>${h ? h + 'h ' : ''}${m}m</b>`);
        }
      }
    }
    return parts.join(' · ');
  }

  function renderDayList() {
    daylistEl.textContent = '';
    const byId = collectTasks();
    const list = [...days].sort().reverse();
    if (!list.length) {
      const s = document.createElement('div');
      s.className = 'empty-hint';
      s.textContent = '还没有记录';
      daylistEl.appendChild(s);
      return;
    }
    for (const d of list) {
      const b = document.createElement('button');
      b.className = 'day-item' + (d === selected ? ' active' : '');
      const cnt = tasksOfDay(d, byId).length;
      b.innerHTML = `<span>${d}</span><span class="cnt">${cnt ? cnt + ' 项' : ''}</span>`;
      b.addEventListener('click', () => select(d));
      daylistEl.appendChild(b);
    }
  }

  function renderDetail() {
    const byId = collectTasks();
    const tasks = tasksOfDay(selected, byId);
    detailEl.textContent = '';
    const head = document.createElement('div');
    head.className = 'date-head';
    const h = dateHeading(selected);
    head.innerHTML = `<h2>${h.big} <span style="color:var(--faint);font-size:13px;font-weight:400">${h.sub}</span></h2>`;
    detailEl.appendChild(head);

    if (!tasks.length) {
      const s = document.createElement('div');
      s.className = 'empty-hint';
      s.style.marginTop = '80px';
      s.textContent = '这一天没有任务记录';
      detailEl.appendChild(s);
      return;
    }

    for (const { t, todays } of tasks) {
      const card = document.createElement('div');
      card.className = 'task-card' + (t.state === 'done' ? ' done-task' : '');
      const meta = taskMeta(t, selected);
      const indent = (todays.find(e => e.indent) || {}).indent || 0;
      card.innerHTML = `
        <div class="task-row">
          <span class="state-chip ${t.state === 'done' ? 'done' : ''}">${t.state === 'done' ? '已完成' : '进行中'}</span>
          <span class="txt" style="${indent ? 'padding-left:' + (indent * 18) + 'px' : ''}"></span>
        </div>
        ${meta ? `<div class="task-meta">${meta}</div>` : ''}
        <div class="timeline"></div>`;
      card.querySelector('.txt').textContent = t.text || '（空）';

      const tl = card.querySelector('.timeline');
      for (const e of t.events) {
        const item = document.createElement('div');
        item.className = 'tl-item t-' + e.type;
        item.innerHTML = `<span class="tl-time">${(e.t || '').slice(11, 19)}</span><span class="tl-type">${TYPE_CN[e.type] || e.type}</span>`;
        if (typeof e.text === 'string' && e.text) {
          const tx = document.createElement('span');
          tx.className = 'tl-text';
          tx.textContent = e.text;
          item.appendChild(tx);
        }
        if (e.type === 'imported' && e.from) {
          const f = document.createElement('span');
          f.className = 'tl-from';
          f.textContent = '来自 ' + e.from;
          item.appendChild(f);
        }
        tl.appendChild(item);
      }
      card.addEventListener('click', () => card.classList.toggle('open-tl'));
      detailEl.appendChild(card);
    }
  }

  function select(date) {
    selected = date;
    renderDayList();
    renderDetail();
  }

  async function boot() {
    await Editor.flush();
    AppData.events = await Store.loadEvents();
    days = await Store.listDays();
    renderDayList();
    const t = todayStr();
    select(days.includes(t) ? t : (days[days.length - 1] || t));
  }

  return { boot };
})();

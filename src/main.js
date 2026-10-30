'use strict';

/* ============ 启动与视图切换 ============ */

function bindRail() {
  const btns = document.querySelectorAll('.rail-btn[data-view]');
  for (const b of btns) {
    b.addEventListener('click', () => {
      for (const x of btns) x.classList.toggle('active', x === b);
      const v = b.dataset.view;
      document.querySelectorAll('.view').forEach(s => s.classList.remove('active'));
      document.getElementById(`view-${v}`).classList.add('active');
      if (v === 'trace') Trace.boot();
    });
  }
  /* 极简模式：侧栏默认隐藏，鼠标贴左缘呼出，离开后收回 */
  const hot = document.getElementById('rail-hot');
  const rail = document.getElementById('rail');
  let hideT = null;
  const show = () => { clearTimeout(hideT); document.body.classList.add('rail-show'); };
  const hide = () => { hideT = setTimeout(() => document.body.classList.remove('rail-show'), 120); };
  hot.addEventListener('mouseenter', show);
  hot.addEventListener('mouseleave', hide);
  rail.addEventListener('mouseenter', show);
  rail.addEventListener('mouseleave', hide);
}

/* ---------- 设置页：外观 / 窗口与系统 / 存储 ---------- */

const EDITOR_FONTS = {
  default: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", "Source Han Serif SC", "Noto Serif SC", serif',
  mono: '"Cascadia Mono", Consolas, "Sarasa Mono SC", monospace',
};

function applyAppearance(s) {
  const root = document.documentElement;
  if (s.theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = s.theme;
  root.style.setProperty('--editor-font', EDITOR_FONTS[s.font_family] || EDITOR_FONTS.default);
  root.style.setProperty('--editor-size', (s.font_size || 15) + 'px');
}

async function saveSetting(key, value, btn) {
  if (btn) btn.disabled = true;
  try {
    await Store.setSetting(key, value);
    return true;
  } catch (err) {
    toast('保存设置失败：' + err);
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ---------- 无边框模式：隐藏系统标题栏，顶部拖动 + 右上角窗控 ---------- */

function tauriWindow() {
  try { return window.__TAURI__.window.getCurrentWindow(); } catch { return null; }
}

function applyFrameless(on) {
  document.body.classList.toggle('frameless', !!on);
  const w = tauriWindow();
  if (!w) return;
  w.setDecorations(!on).catch(() => {});
}

function bindWinCtrls() {
  const minBtn = document.getElementById('win-min');
  const closeBtn = document.getElementById('win-close');
  if (!minBtn || !closeBtn) return;
  minBtn.addEventListener('click', () => { const w = tauriWindow(); if (w) w.minimize().catch(() => {}); });
  closeBtn.addEventListener('click', () => { const w = tauriWindow(); if (w) w.close().catch(() => {}); });
}

function bindSettings() {
  document.getElementById('btn-settings').addEventListener('click', async () => {
    let s;
    try { s = await Store.getSettings(); } catch (err) { toast('读取设置失败：' + err); return; }
    openSettingsModal(s);
  });
}

function openSettingsModal(s) {
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `
    <div class="modal wide" role="dialog" aria-label="设置">
      <div class="modal-head"><b>设置</b><span class="modal-sub">外观与窗口行为即时生效，无需重启</span></div>
      <div class="modal-body">
        <div class="set-sec-title">外观</div>
        <div class="set-line">
          <div><div class="set-name">主题</div></div>
          <div class="seg" id="set-theme">
            <button data-v="auto">跟随系统</button>
            <button data-v="light">浅色</button>
            <button data-v="dark">深色</button>
          </div>
        </div>
        <div class="set-line">
          <div><div class="set-name">正文字体</div></div>
          <select class="set-input sel" id="set-font">
            <option value="default">无衬线（默认）</option>
            <option value="serif">衬线</option>
            <option value="mono">等宽</option>
          </select>
        </div>
        <div class="set-line">
          <div><div class="set-name">正文字号 <span class="size-val" id="size-val"></span></div></div>
          <input class="size-range" id="set-size" type="range" min="12" max="20" step="1" />
        </div>
        <div class="font-prev" id="font-prev">写周报初稿 · 回复导师邮件 · 2026-10-17</div>

        <div class="set-sec-title">窗口与系统</div>
        <div class="set-line">
          <div><div class="set-name">窗口置顶</div><div class="set-desc">便签始终悬浮在其他窗口之上</div></div>
          <button class="switch" id="sw-pin" aria-label="窗口置顶"></button>
        </div>
        <div class="set-line">
          <div><div class="set-name">隐藏标题栏</div><div class="set-desc">极简无边框：顶部悬停区可拖动窗口，右上角悬停出最小化 / 关闭</div></div>
          <button class="switch" id="sw-frameless" aria-label="隐藏标题栏"></button>
        </div>
        <div class="set-line">
          <div><div class="set-name">托盘常驻</div><div class="set-desc">点关闭时缩到系统托盘，点击托盘图标恢复</div></div>
          <button class="switch" id="sw-tray" aria-label="托盘常驻"></button>
        </div>
        <div class="set-line">
          <div><div class="set-name">开机自启</div><div class="set-desc">登录 Windows 后自动运行（写入当前用户启动项，无需管理员）</div></div>
          <button class="switch" id="sw-auto" aria-label="开机自启"></button>
        </div>

        <div class="set-sec-title">存储</div>
        <div class="set-row">
          <div class="set-label">当前存储目录</div>
          <div class="set-cur"></div>
        </div>
        <div class="set-row">
          <div class="set-label">新目录（绝对路径，如 D:\\Notes\\EaseDo；留空恢复默认「文档\\EaseDo」）</div>
          <input class="set-input" id="set-path" type="text" spellcheck="false" placeholder="D:\\Notes\\EaseDo" />
        </div>
      </div>
      <div class="modal-foot">
        <span class="modal-note">切换目录后自动创建结构，旧数据不自动搬移</span>
        <button class="btn ghost" id="set-default">恢复默认</button>
        <button class="btn primary" id="set-save">保存目录</button>
      </div>
    </div>`;
  ov.querySelector('.set-cur').textContent = s.data_dir || s.dataDir || '';

  /* ---- 外观：即时生效 + 即时持久化 ---- */
  const themeSeg = ov.querySelector('#set-theme');
  const themeBtns = [...themeSeg.querySelectorAll('button')];
  const paintTheme = v => themeBtns.forEach(b => b.classList.toggle('active', b.dataset.v === v));
  paintTheme(s.theme || 'auto');
  themeBtns.forEach(b => b.addEventListener('click', async () => {
    if (b.classList.contains('active')) return;
    const prev = s.theme;
    s.theme = b.dataset.v;
    paintTheme(s.theme);
    applyAppearance(s);
    if (!(await saveSetting('theme', s.theme, b))) { s.theme = prev; applyAppearance(s); paintTheme(s.theme); }
  }));

  const fontSel = ov.querySelector('#set-font');
  fontSel.value = s.font_family || 'default';
  fontSel.addEventListener('change', async () => {
    const prev = s.font_family;
    s.font_family = fontSel.value;
    applyAppearance(s);
    if (!(await saveSetting('font_family', s.font_family))) { s.font_family = prev; applyAppearance(s); fontSel.value = prev; }
  });

  const sizeInput = ov.querySelector('#set-size');
  const sizeVal = ov.querySelector('#size-val');
  sizeInput.value = s.font_size || 15;
  sizeVal.textContent = sizeInput.value + ' px';
  sizeInput.addEventListener('input', () => {
    s.font_size = Number(sizeInput.value);
    sizeVal.textContent = sizeInput.value + ' px';
    applyAppearance(s);
  });
  sizeInput.addEventListener('change', () => saveSetting('font_size', s.font_size));

  /* ---- 开关 ---- */
  function bindSwitch(id, key, label, def = false) {
    const el = ov.querySelector('#' + id);
    const paint = on => el.classList.toggle('on', on);
    let cur = s[key] === undefined ? def : !!s[key];
    paint(cur);
    el.addEventListener('click', async () => {
      const prev = cur;
      const next = !cur;
      paint(next);
      if (!(await saveSetting(key, next, el))) { paint(prev); return; }
      cur = next;
      s[key] = next;
      if (key === 'tray' && next) toast('已开启托盘常驻：点关闭将缩到托盘');
      if (key === 'autostart' && next) toast(label + '已开启');
      if (key === 'frameless') applyFrameless(next);
    });
  }
  bindSwitch('sw-pin', 'pin_top', '窗口置顶');
  bindSwitch('sw-frameless', 'frameless', '隐藏标题栏', true);
  bindSwitch('sw-tray', 'tray', '托盘常驻');
  bindSwitch('sw-auto', 'autostart', '开机自启');

  /* ---- 存储：沿用显式保存 ---- */
  const input = ov.querySelector('#set-path');
  const saveBtn = ov.querySelector('#set-save');
  const defBtn = ov.querySelector('#set-default');
  const close = () => ov.remove();
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  defBtn.addEventListener('click', async () => {
    defBtn.disabled = saveBtn.disabled = true;
    try {
      await Store.setDataDir('');
      close();
      toast('已恢复默认目录，正在重新载入…');
      setTimeout(() => location.reload(), 700);
    } catch (err) { toast('恢复默认失败：' + err); defBtn.disabled = saveBtn.disabled = false; }
  });
  saveBtn.addEventListener('click', async () => {
    const p = input.value.trim();
    if (!p) { toast('请填写目录路径，或点「恢复默认」'); return; }
    saveBtn.disabled = true;
    try {
      const r = await Store.setDataDir(p);
      close();
      if (r.changed === false) { toast('存储目录未变化'); return; }
      toast('存储目录已切换，正在重新载入…');
      setTimeout(() => location.reload(), 700);
    } catch (err) { toast('切换失败：' + err); saveBtn.disabled = false; }
  });

  document.body.appendChild(ov);
}

(async function boot() {
  bindRail();
  bindWinCtrls();
  try {
    const info = await Store.init();
    AppData.dataDir = info.dataDir || Store.dataDir;
    let settings = {};
    try { settings = await Store.getSettings(); } catch { /* 外观设置读取失败不阻塞启动 */ }
    applyAppearance(settings);
    applyFrameless(settings.frameless !== false);
    const events = await Store.loadEvents();
    Editor.boot(events);
    await Editor.loadDay(todayStr());
    Report.bindButtons();
    bindSettings();
    if (!HAS_TAURI) {
      toast('浏览器预览模式：数据保存在本页 localStorage');
    }
  } catch (err) {
    toast('初始化失败：' + err, 6000);
  }
})();

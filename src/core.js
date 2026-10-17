'use strict';

/* ============ 存储适配层：Tauri 命令 / 浏览器预览 ============ */

const HAS_TAURI = typeof window.__TAURI__ !== 'undefined' && !!window.__TAURI__.core;

const BrowserStore = (() => {
  const KEY = 'todaytrace-mock-v1';
  const safeLS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* 存储不可用时预览数据不持久化 */ } },
  };
  let data;
  try { data = JSON.parse(safeLS.get(KEY)) || {}; } catch { data = {}; }
  data.days = data.days || {};
  data.events = data.events || [];
  const flush = () => safeLS.set(KEY, JSON.stringify(data));
  function download(name, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.split('/').pop();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  return {
    mode: 'browser',
    dataDir: '（浏览器预览：数据仅存于本页 localStorage）',
    async init() { return { dataDir: this.dataDir, days: Object.keys(data.days).sort() }; },
    async loadDay(date) { return { content: data.days[date] ?? null }; },
    async saveDay(date, content) { data.days[date] = content; flush(); },
    async appendEvents(events) { data.events.push(...events); flush(); },
    async loadEvents() { return data.events.slice(); },
    async listDays() { return Object.keys(data.days).sort(); },
    async saveFile(rel, content) { data['f:' + rel] = content; flush(); download(rel, content); return rel; },
    async getDataDir() { return { dataDir: this.dataDir, isCustom: false }; },
    async setDataDir() { return { dataDir: this.dataDir, changed: false }; },
    async getSettings() {
      return Object.assign(
        { theme: 'auto', font_family: 'default', font_size: 15, pin_top: false, tray: false, autostart: false, data_dir: this.dataDir },
        data.settings || {},
        { data_dir: this.dataDir }
      );
    },
    async setSetting(key, value) { data.settings = data.settings || {}; data.settings[key] = value; flush(); return { ok: true }; },
  };
})();

const TauriStore = {
  mode: 'tauri',
  dataDir: '',
  _invoke() { return window.__TAURI__.core.invoke; },
  async init() {
    const r = await this._invoke()('app_init');
    this.dataDir = r.dataDir;
    return r;
  },
  async loadDay(date) { return this._invoke()('load_day', { date }); },
  async saveDay(date, content) { return this._invoke()('save_day', { date, content }); },
  async appendEvents(events) { return this._invoke()('append_events', { events }); },
  async loadEvents() { return this._invoke()('load_events'); },
  async listDays() { return this._invoke()('list_days'); },
  async saveFile(rel, content) { return this._invoke()('save_file', { rel, content }); },
  async getDataDir() { return this._invoke()('get_data_dir'); },
  async setDataDir(path) { return this._invoke()('set_data_dir', { path }); },
  async getSettings() { return this._invoke()('get_settings'); },
  async setSetting(key, value) { return this._invoke()('set_setting', { key, value }); },
};

const Store = HAS_TAURI ? TauriStore : BrowserStore;

/* ============ 共享状态与通用工具 ============ */

const AppData = { events: [], dataDir: '' };

/* 业务日：以凌晨 6 点为分界。6 点前（含）属于前一个自然日，
   便于深夜工作不被零点打断。时间戳本身仍记真实时刻，仅在
   归组（今天归属哪个文件 / 哪一天的统计）时经 dayKey 换算。 */
const DAY_SPLIT_MS = 6 * 3600 * 1000;

function bizNow() {
  return new Date(Date.now() - DAY_SPLIT_MS);
}

function dayKey(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() - DAY_SPLIT_MS);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function todayStr(offset = 0) {
  const d = bizNow();
  d.setDate(d.getDate() + offset);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nowISO() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

function dateHeading(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  const w = WEEK_CN[new Date(dateStr + 'T12:00:00').getDay()];
  return { big: `${m}月${d}日`, sub: `${dateStr.slice(0, 4)} 年 · 星期${w}` };
}

function hhmm(iso) {
  return iso ? iso.slice(11, 16) : '';
}

function toast(msg, ms = 2800) {
  const t = document.getElementById('toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.remove('show'), ms);
}

function isoWeek(date) {
  const dt = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - y0) / 86400000 + 1) / 7);
  return { year: dt.getUTCFullYear(), week };
}

function mondayOf(d) {
  const m = new Date(d);
  const day = (m.getDay() + 6) % 7;
  m.setDate(m.getDate() - day);
  return m;
}

/*
 * Trình điều khiển Chrome tối giản qua DevTools Protocol (chỉ dùng cho kiểm thử).
 * Cần Node >= 22 (có sẵn WebSocket) và Chrome/Edge cài trên máy.
 */
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Page {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.listeners = {};
    this.errors = [];
    this.requests = [];
  }
  send(method, params) { return this.browser.send(method, params, this.sessionId); }
  on(method, fn) { (this.listeners[method] = this.listeners[method] || []).push(fn); }
  once(method) { return new Promise((resolve) => { const fn = (p) => { this.listeners[method] = this.listeners[method].filter((f) => f !== fn); resolve(p); }; this.on(method, fn); }); }
  emit(method, params) { (this.listeners[method] || []).slice().forEach((fn) => fn(params)); }
  async init() {
    this.on('Runtime.exceptionThrown', (p) => this.errors.push('exception: ' + (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)));
    this.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') this.errors.push('console.error: ' + p.args.map((a) => a.value || a.description).join(' ')); });
    this.on('Network.requestWillBeSent', (p) => this.requests.push(p.request.url));
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
  }
  async goto(url) { const load = this.once('Page.loadEventFired'); await this.send('Page.navigate', { url }); await load; await sleep(150); }
  async reload() { const load = this.once('Page.loadEventFired'); await this.send('Page.reload', { ignoreCache: true }); await load; await sleep(150); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval lỗi: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text) + '\n  ' + expression.slice(0, 200));
    return r.result.value;
  }
  async waitFor(expression, timeout = 8000, label) {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval('!!(' + expression + ')')) return;
      if (Date.now() - t0 > timeout) throw new Error('Hết thời gian chờ: ' + (label || expression));
      await sleep(80);
    }
  }
  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  async reducedMotion(on) {
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] });
  }
  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  async close() { await this.browser.send('Target.closeTarget', { targetId: this.targetId }); }
}

class Browser {
  static async launch(port = 9339) {
    const exe = CANDIDATES.find((p) => fs.existsSync(p));
    if (!exe) throw new Error('Không tìm thấy Chrome/Edge. Đặt biến CHROME_PATH.');
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-e2e-'));
    const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + userDir, '--no-first-run',
      '--no-default-browser-check', '--disable-extensions', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
    let info = null;
    for (let i = 0; i < 100 && !info; i++) {
      try { info = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); } catch (e) { await sleep(100); }
    }
    if (!info) throw new Error('Chrome không mở cổng DevTools.');
    const b = new Browser(proc, userDir);
    await b.connect(info.webSocketDebuggerUrl);
    return b;
  }
  constructor(proc, userDir) { this.proc = proc; this.userDir = userDir; this.nextId = 1; this.pending = new Map(); this.pages = new Map(); }
  connect(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: ok, reject: bad } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? bad(new Error(msg.error.message)) : ok(msg.result);
        } else if (msg.sessionId && this.pages.has(msg.sessionId)) {
          this.pages.get(msg.sessionId).emit(msg.method, msg.params);
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify(msg)); });
  }
  async newPage(onBeforeLoadScript) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId);
    this.pages.set(sessionId, page);
    await page.init();
    if (onBeforeLoadScript) await page.send('Page.addScriptToEvaluateOnNewDocument', { source: onBeforeLoadScript });
    return page;
  }
  async close() {
    try { await this.send('Browser.close'); } catch (e) { /* đã đóng */ }
    await sleep(300);
    try { this.proc.kill(); } catch (e) { /* bỏ qua */ }
    try { fs.rmSync(this.userDir, { recursive: true, force: true }); } catch (e) { /* bỏ qua */ }
  }
}

module.exports = { Browser, sleep };

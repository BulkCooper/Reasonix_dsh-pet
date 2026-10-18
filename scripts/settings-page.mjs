/** 余额设置页（由余额服务在 127.0.0.1:34741/settings 提供，系统浏览器打开） */
export const SETTINGS_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Reasonix 桌宠 · 余额设置</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f6fb; color: #202124; font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif; }
  .wrap { max-width: 560px; margin: 42px auto; background: #fff; border-radius: 16px; padding: 28px 30px 24px; box-shadow: 0 12px 40px rgba(30, 40, 80, .1); }
  h1 { margin: 0 0 6px; font-size: 20px; }
  h2 { margin: 26px 0 8px; font-size: 15px; color: #333; }
  .sub { margin: 0 0 18px; color: #777; font-size: 12px; line-height: 1.6; }
  label { display: block; margin: 16px 0 6px; font-size: 13px; font-weight: 600; }
  input[type=password], input[type=number] { width: 100%; padding: 10px 12px; border: 1px solid #d9dee8; border-radius: 8px; font-size: 14px; outline: none; }
  input:focus { border-color: #4b7bec; box-shadow: 0 0 0 3px rgba(75, 123, 236, .12); }
  .hint { margin-top: 6px; color: #888; font-size: 12px; line-height: 1.5; }
  .check { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-weight: 400; color: #555; }
  .check input { width: auto; }
  .row { display: flex; gap: 10px; margin-top: 22px; }
  button { padding: 10px 20px; border: 0; border-radius: 8px; background: #4b7bec; color: #fff; font-size: 14px; cursor: pointer; }
  button.secondary { background: #eef2f9; color: #345; }
  button:hover { filter: brightness(.96); }
  #message { min-height: 20px; margin-top: 14px; color: #2c8a4b; font-size: 13px; }
  pre { background: #f7f9fd; border: 1px solid #e8edf6; border-radius: 10px; padding: 12px; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; }
  code { background: #f1f4fa; padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Reasonix 桌宠 · 余额设置</h1>
  <p class="sub">保存后立即生效；API key 只保存在本机 <code>home/balance-config.json</code>，不会写日志。留空表示继续使用现有的 key 或 Reasonix 的 <code>.env</code>。</p>

  <label for="apiKey">DeepSeek API Key</label>
  <input id="apiKey" type="password" placeholder="sk-...（留空 = 不改动 / 使用 .env）" autocomplete="off">
  <div class="hint" id="keyState">读取中…</div>
  <label class="check"><input id="clearKey" type="checkbox"> 清除已保存的 key（改用环境变量 / .env）</label>

  <label for="refreshSec">自动刷新间隔（秒）</label>
  <input id="refreshSec" type="number" min="15" step="1" value="60">

  <label for="alertThreshold">余额预警阈值（元，0 = 关闭）</label>
  <input id="alertThreshold" type="number" min="0" step="0.01" value="10">

  <div class="row">
    <button id="save">保存</button>
    <button id="refresh" class="secondary">立即刷新余额</button>
    <button id="close" class="secondary">关闭</button>
  </div>
  <div id="message"></div>

  <h2>当前状态</h2>
  <pre id="status">加载中…</pre>
</div>
<script>
  var $ = function (id) { return document.getElementById(id); };
  function showStatus(data) {
    $('status').textContent = JSON.stringify(data, null, 2);
  }
  async function load() {
    var r = await fetch('/settings/data');
    var d = await r.json();
    $('refreshSec').value = d.refreshSec;
    $('alertThreshold').value = d.alertThreshold;
    $('keyState').textContent = d.hasConfigKey
      ? '已保存到插件配置'
      : (d.hasEnvKey ? '当前使用环境变量 / .env 中的 DEEPSEEK_API_KEY' : '未配置 key');
    var s = await fetch('/status');
    showStatus(await s.json());
  }
  $('save').onclick = async function () {
    var body = {
      apiKey: $('apiKey').value,
      clearApiKey: $('clearKey').checked,
      refreshSec: Number($('refreshSec').value),
      alertThreshold: Number($('alertThreshold').value)
    };
    var r = await fetch('/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    var d = await r.json();
    $('message').textContent = d.ok ? '已保存' : ('保存失败：' + (d.error || '未知错误'));
    if (d.ok) {
      $('apiKey').value = '';
      $('clearKey').checked = false;
      await load();
    }
  };
  $('refresh').onclick = async function () {
    $('message').textContent = '刷新中…';
    await fetch('/refresh', { method: 'POST' });
    $('message').textContent = '已刷新';
    await load();
  };
  $('close').onclick = function () { window.close(); };
  load();
</script>
</body>
</html>`;

/** 余额设置页（由余额服务在 127.0.0.1:34741/settings 提供，系统浏览器打开） */
export const SETTINGS_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Reasonix 桌宠 · 余额设置</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f6fb; color: #202124; font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif; }
  .wrap { max-width: 620px; margin: 42px auto; background: #fff; border-radius: 16px; padding: 28px 30px 24px; box-shadow: 0 12px 40px rgba(30, 40, 80, .1); }
  h1 { margin: 0 0 6px; font-size: 20px; }
  h2 { margin: 26px 0 8px; font-size: 15px; color: #333; }
  .sub { margin: 0 0 18px; color: #777; font-size: 12px; line-height: 1.6; }
  label { display: block; margin: 16px 0 6px; font-size: 13px; font-weight: 600; }
  input[type=password], input[type=number] { width: 100%; padding: 10px 12px; border: 1px solid #d9dee8; border-radius: 8px; font-size: 14px; outline: none; }
  input:focus { border-color: #4b7bec; box-shadow: 0 0 0 3px rgba(75, 123, 236, .12); }
  .hint { margin-top: 6px; color: #888; font-size: 12px; line-height: 1.5; }
  .check { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-weight: 400; color: #555; }
  .check input { width: auto; }
  .row { display: flex; align-items: center; gap: 10px; margin-top: 18px; }
  button { padding: 10px 20px; border: 0; border-radius: 8px; background: #4b7bec; color: #fff; font-size: 14px; cursor: pointer; }
  button.secondary { background: #eef2f9; color: #345; }
  button:disabled { opacity: .55; cursor: not-allowed; }
  button:hover:not(:disabled) { filter: brightness(.96); }
  #message { min-height: 20px; margin-top: 14px; color: #2c8a4b; font-size: 13px; }
  pre { background: #f7f9fd; border: 1px solid #e8edf6; border-radius: 10px; padding: 12px; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; }
  code { background: #f1f4fa; padding: 1px 5px; border-radius: 4px; }
  .sound-list { border: 1px solid #e6ebf4; border-radius: 10px; padding: 8px 12px; max-height: 190px; overflow: auto; }
  .sound-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-weight: 400; }
  .sound-row input[type=radio] { width: auto; }
  .sound-row span { flex: 1; font-size: 13px; }
  .sound-row button { padding: 4px 10px; font-size: 12px; }
  .trim { margin-top: 10px; }
  .trim .row { margin-top: 8px; }
  #soundFile { display: none; }
  input[type=text], textarea { width: 100%; padding: 10px 12px; border: 1px solid #d9dee8; border-radius: 8px; font-size: 14px; outline: none; font-family: inherit; }
  textarea { resize: vertical; line-height: 1.5; }
  select { width: 100%; padding: 10px 12px; border: 1px solid #d9dee8; border-radius: 8px; font-size: 14px; background: #fff; }
  .savebar { position: sticky; bottom: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; background: #fff; padding: 12px 0; border-top: 1px solid #e6e9f0; z-index: 20; }
  .savebar #message { margin-left: auto; color: #5b6472; font-size: 13px; }
  .account-list { display: flex; flex-direction: column; gap: 10px; }
  .account-card { border: 1px solid #e6ebf4; border-radius: 10px; padding: 12px; background: #fbfcff; }
  .account-head { display: flex; align-items: center; gap: 8px; }
  .account-head input.account-name { flex: 1 1 auto; min-width: 0; }
  .account-state { flex: 0 0 auto; font-size: 12px; color: #5b6472; background: #eef2f9; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
  .account-state.ok { background: #e8f6ee; color: #1f7a45; }
  .account-state.bad { background: #fdecec; color: #a33; }
  .account-del { flex: 0 0 auto; padding: 6px 12px; font-size: 12px; background: #fdecec; color: #a33; }
  .account-card .field-row { display: flex; gap: 10px; }
  .account-card .field-col { flex: 1 1 0; min-width: 0; }
  .account-card label { margin: 10px 0 4px; font-size: 12px; color: #555; }
  .account-card input[type=text], .account-card input[type=password] { padding: 8px 10px; font-size: 13px; }
  .account-empty { color: #8a93a2; font-size: 13px; padding: 10px 0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Reasonix 桌宠 · 余额设置</h1>
  <p class="sub">保存后立即生效。API key 只保存在本机 <code>home/balance-config.json</code>，不会写日志，也不会通过接口返回；本插件不读取 Reasonix 的 <code>.env</code> / <code>config.toml</code> / <code>stats</code>，也不读取其他组件的凭证。账户只能在这里手动添加。</p>

  <h2>余额账户</h2>
  <p class="sub">最多 10 个账户，可分别填写名称、余额接口 URL 和 API key。勾选「气泡显示」的账户会出现在双击气泡里；第一个查到余额的账户作为主账户，驱动余额预警和今日已用。</p>
  <div id="accounts" class="account-list"></div>
  <div class="row">
    <button id="addAccount" class="secondary" type="button">新建账户</button>
    <span class="hint" id="accountSummary">加载中…</span>
  </div>
  <div class="hint">余额接口只接受 http(s) 地址，默认 <code>https://api.deepseek.com/user/balance</code>。key 输入框留空 = 保留已保存的 key；删除账户会同时删除它的 key。</div>

  <label for="refreshSec">自动刷新间隔（秒）</label>
  <input id="refreshSec" type="number" min="15" step="1" value="60">

  <label for="alertThreshold">余额预警阈值（元，0 = 关闭）</label>
  <input id="alertThreshold" type="number" min="0" step="0.01" value="10">

  <h2>桌宠行为</h2>
  <label class="check"><input id="autoReturnEnabled" type="checkbox" checked> 自动回到 Reasonix 窗口右下角</label>
  <div class="hint">窗口关闭或最小化时回到屏幕右下角。取消勾选后完全不自动移动。</div>
  <label for="autoReturnDelaySec">被拖走后等待（秒）</label>
  <input id="autoReturnDelaySec" type="number" min="0" step="1" value="60">
  <div class="hint">拖拽结束至少等待这么久，桌宠才会自动归位；0 = 立即归位。</div>
  <div class="hint">右键桌宠 →「回归位置」二级菜单可指定当前位置为窗口回归位置。</div>
  <button id="resetReturnAnchor" class="secondary" type="button">恢复默认窗口回归位置</button>
  <div class="hint">清除自定义回归位置；Reasonix 窗口关闭/最小化时回到配置的初始角落。</div>

  <h2>外观</h2>
  <label for="petSize">桌宠大小（px）</label>
  <input id="petSize" type="number" min="160" max="640" step="10" value="320">
  <div class="hint">保存后会重建桌面窗口；160–640 px。</div>
  <label for="bubbleScale">文字弹窗大小（倍率）</label>
  <input id="bubbleScale" type="number" min="0.6" max="2" step="0.1" value="1">
  <div class="hint">控制气泡的宽度与内边距，不改变文字大小；最多 2 秒生效。</div>
  <label for="bubbleFontSize">文字大小（px）</label>
  <input id="bubbleFontSize" type="number" min="10" max="30" step="1" value="14">
  <div class="hint">独立于弹窗大小；最多 2 秒生效。</div>

  <h2>点击音效</h2>
  <p class="sub">分别选择「按下」和「松开」的音效；也可以导入本地音频并裁剪。保存后下一次点击立即使用。</p>
  <label for="pressSound">按下音效</label>
  <select id="pressSound"></select>
  <div class="row">
    <button id="previewPress" class="secondary" type="button">试听按下</button>
  </div>
  <label for="releaseSound">松开音效</label>
  <select id="releaseSound"></select>
  <div class="row">
    <button id="previewRelease" class="secondary" type="button">试听松开</button>
  </div>
  <div class="row">
    <input id="soundFile" type="file" accept="audio/*">
    <button id="importSound" class="secondary" type="button">导入音频…</button>
  </div>
  <label for="trimSource">裁剪源音效</label>
  <select id="trimSource"></select>
  <div class="trim">
    <label for="trimStart">裁剪起止（秒）</label>
    <div class="row">
      <input id="trimStart" type="number" min="0" step="0.01" value="0" placeholder="开始">
      <input id="trimEnd" type="number" min="0" step="0.01" placeholder="结束">
      <button id="trimSound" class="secondary" type="button">裁剪并保存</button>
    </div>
    <div class="hint">起止时间按裁剪源音效的实际时长填写；裁剪结果会保存为 WAV 自定义音效。</div>
  </div>

  <h2>对话 API</h2>
  <p class="sub">桌宠右键「对话 / 碎碎念」使用这个 OpenAI 兼容接口。对话 API Key 留空会复用第一个有 key 的账户。</p>
  <label for="chatBaseUrl">Base URL</label>
  <input id="chatBaseUrl" type="text" placeholder="https://api.deepseek.com/v1">
  <label for="chatModel">模型</label>
  <input id="chatModel" type="text" placeholder="deepseek-chat">
  <label for="chatApiKey">对话 API Key（可留空）</label>
  <input id="chatApiKey" type="password" placeholder="sk-..." autocomplete="off">
  <div class="hint" id="chatKeyState"></div>
  <label class="check"><input id="clearChatKey" type="checkbox"> 清除已保存的对话 key</label>
  <label for="chatPrompt">人设 / 系统提示词</label>
  <textarea id="chatPrompt" rows="3"></textarea>

  <h2>当前状态</h2>
  <pre id="status">加载中…</pre>
</div>
  <div class="savebar">
    <button id="save" disabled>保存设置</button>
    <button id="refresh" class="secondary" type="button">立即刷新余额</button>
    <button id="clearSpent" class="secondary" type="button">清除今日已用</button>
    <button id="close" class="secondary" type="button">关闭</button>
    <span id="message"></span>
  </div>

<script>
  var $ = function (id) { return document.getElementById(id); };
  var settingsReady = false;
  var saving = false;
  var loadFailed = false;
  var maxAccounts = 10;
  var defaultBalanceUrl = '';
  var soundMap = {};

  function errText(error) {
    return error && error.message ? error.message : String(error);
  }
  function showStatus(data) {
    $('status').textContent = JSON.stringify(data, null, 2);
  }
  function fillSelect(select, sounds, selected) {
    var current = select.value;
    select.innerHTML = '';
    sounds.forEach(function (sound) {
      var option = document.createElement('option');
      option.value = sound.id;
      option.textContent = sound.name + (sound.builtin ? '（内置）' : '');
      select.appendChild(option);
    });
    select.value = selected || current || (sounds[0] && sounds[0].id) || '';
  }
  function playSoundUrl(url) {
    try {
      var audio = new Audio(url);
      audio.volume = 0.85;
      audio.play().catch(function () {});
    } catch (e) {}
  }
  async function loadSounds() {
    var d = await fetch('/sounds').then(function (r) { return r.json(); });
    soundMap = {};
    d.sounds.forEach(function (sound) { soundMap[sound.id] = sound; });
    fillSelect($('pressSound'), d.sounds, d.press);
    fillSelect($('releaseSound'), d.sounds, d.release);
    fillSelect($('trimSource'), d.sounds, d.press);
  }
  function writeString(view, offset, value) {
    for (var i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  }
  function encodeWav(buffer, start, end) {
    var channels = buffer.numberOfChannels;
    var sampleRate = buffer.sampleRate;
    var startSample = Math.floor(start * sampleRate);
    var endSample = Math.floor(end * sampleRate);
    var length = endSample - startSample;
    var bytesPerSample = 2;
    var blockAlign = channels * bytesPerSample;
    var dataSize = length * blockAlign;
    var ab = new ArrayBuffer(44 + dataSize);
    var view = new DataView(ab);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    var offset = 44;
    var datas = [];
    for (var c = 0; c < channels; c++) datas.push(buffer.getChannelData(c));
    for (var i = startSample; i < endSample; i++) {
      for (var c2 = 0; c2 < channels; c2++) {
        var sample = Math.max(-1, Math.min(1, datas[c2][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  /* ---------------- 账户区 ---------------- */
  function statusText(status) {
    var value = String(status || '');
    if (value === 'ok') return '已查询';
    if (value === 'no-key') return '未配置 key';
    if (value === 'no-url') return '未填接口';
    if (value === 'timeout') return '查询超时';
    if (value === 'network') return '网络错误';
    if (value === 'bad-response') return '接口异常';
    if (value === 'http-401' || value === 'http-403') return 'key 无效';
    if (value.indexOf('http-') === 0) return 'HTTP ' + value.slice(5);
    return '查询失败';
  }
  function accountCards() {
    return document.querySelectorAll('#accounts .account-card');
  }
  function updateAccountSummary() {
    var count = accountCards().length;
    $('accountSummary').textContent = count + ' / ' + maxAccounts + ' 个账户';
    $('addAccount').disabled = count >= maxAccounts;
  }
  function setAccountState(card, text, tone) {
    var badge = card.querySelector('.account-state');
    if (!badge) return;
    badge.textContent = text;
    badge.className = 'account-state' + (tone ? ' ' + tone : '');
  }
  function makeLabel(text) {
    var label = document.createElement('label');
    label.textContent = text;
    return label;
  }
  function accountCard(account) {
    var a = account || {};
    var card = document.createElement('div');
    card.className = 'account-card';
    card.setAttribute('data-id', a.id || '');
    card.setAttribute('data-has-key', a.hasKey ? '1' : '');

    var head = document.createElement('div');
    head.className = 'account-head';

    var name = document.createElement('input');
    name.type = 'text';
    name.className = 'account-name';
    name.maxLength = 40;
    name.placeholder = '账户名称';
    name.value = a.name || '';

    var badge = document.createElement('span');
    badge.className = 'account-state';
    badge.textContent = a.hasKey ? '已保存 key' : '未配置 key';

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'account-del';
    del.textContent = '删除';
    del.onclick = function () {
      if (card.parentNode) card.parentNode.removeChild(card);
      if (!accountCards().length) {
        var note = document.createElement('div');
        note.className = 'account-empty';
        note.textContent = '还没有账户。点下方「新建账户」添加第一个余额账户。';
        $('accounts').appendChild(note);
      }
      updateAccountSummary();
      $('message').textContent = '已移除该账户，点「保存设置」后生效';
    };

    head.appendChild(name);
    head.appendChild(badge);
    head.appendChild(del);

    var fields = document.createElement('div');
    fields.className = 'field-row';

    var urlCol = document.createElement('div');
    urlCol.className = 'field-col';
    var url = document.createElement('input');
    url.type = 'text';
    url.className = 'account-url';
    url.placeholder = defaultBalanceUrl || 'https://api.deepseek.com/user/balance';
    url.value = a.balanceUrl || '';
    urlCol.appendChild(makeLabel('余额接口 URL'));
    urlCol.appendChild(url);

    var keyCol = document.createElement('div');
    keyCol.className = 'field-col';
    var key = document.createElement('input');
    key.type = 'password';
    key.className = 'account-key';
    key.autocomplete = 'new-password';
    key.placeholder = a.hasKey ? '留空 = 保留原 key' : 'sk-...';
    keyCol.appendChild(makeLabel('API key'));
    keyCol.appendChild(key);

    fields.appendChild(urlCol);
    fields.appendChild(keyCol);

    var check = document.createElement('label');
    check.className = 'check';
    var visible = document.createElement('input');
    visible.type = 'checkbox';
    visible.className = 'account-visible';
    visible.checked = a.visible !== false;
    check.appendChild(visible);
    check.appendChild(document.createTextNode(' 气泡里显示这个账户'));

    card.appendChild(head);
    card.appendChild(fields);
    card.appendChild(check);
    return card;
  }
  function renderAccounts(list) {
    var box = $('accounts');
    box.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'account-empty';
      empty.textContent = '还没有账户。点下方「新建账户」添加第一个余额账户。';
      box.appendChild(empty);
    } else {
      list.forEach(function (account) { box.appendChild(accountCard(account)); });
    }
    updateAccountSummary();
  }
  function collectAccounts() {
    var cards = accountCards();
    var list = [];
    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      var nameInput = card.querySelector('.account-name');
      var urlInput = card.querySelector('.account-url');
      var keyInput = card.querySelector('.account-key');
      var visInput = card.querySelector('.account-visible');
      list.push({
        id: card.getAttribute('data-id') || '',
        name: nameInput ? nameInput.value : '',
        balanceUrl: urlInput ? urlInput.value : '',
        key: keyInput ? keyInput.value : '',
        visible: visInput ? visInput.checked : true
      });
    }
    return list;
  }
  function applyAccountStatus(accounts) {
    var map = {};
    (accounts || []).forEach(function (account) {
      if (account && account.id) map[account.id] = account;
    });
    var cards = accountCards();
    for (var i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      var id = card.getAttribute('data-id');
      var live = id ? map[id] : null;
      if (live && live.status === 'ok') {
        var money = '¥' + Number(live.total).toFixed(2);
        if (live.currency && live.currency !== 'CNY') money += ' ' + live.currency;
        setAccountState(card, money, 'ok');
      } else if (live) {
        setAccountState(card, statusText(live.status), 'bad');
      } else if (card.getAttribute('data-has-key') === '1') {
        setAccountState(card, '待查询', '');
      } else {
        setAccountState(card, '未配置 key', '');
      }
    }
  }
  $('addAccount').onclick = function () {
    if (accountCards().length >= maxAccounts) {
      $('message').textContent = '最多只能添加 ' + maxAccounts + ' 个账户';
      return;
    }
    var box = $('accounts');
    var empty = box.querySelector('.account-empty');
    if (empty) box.removeChild(empty);
    var card = accountCard({ name: '', balanceUrl: '', visible: true, hasKey: false });
    box.appendChild(card);
    updateAccountSummary();
    var input = card.querySelector('.account-name');
    if (input) input.focus();
    $('message').textContent = '已新增一行，填好后点「保存设置」';
  };

  /* ---------------- 音效 ---------------- */
  $('importSound').onclick = function () { $('soundFile').click(); };
  $('soundFile').onchange = async function () {
    var file = $('soundFile').files[0];
    if (!file) return;
    $('message').textContent = '导入中…';
    var r = await fetch('/sounds/import?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file
    });
    var d = await r.json();
    if (d.ok) {
      await loadSounds();
      $('trimSource').value = d.sound.id;
      $('message').textContent = '已导入「' + d.sound.name + '」，可在下拉中选择，点保存生效';
    } else {
      $('message').textContent = '导入失败：' + (d.error || '');
    }
    $('soundFile').value = '';
  };
  $('previewPress').onclick = function () {
    var id = $('pressSound').value;
    if (id && soundMap[id]) playSoundUrl(soundMap[id].url);
  };
  $('previewRelease').onclick = function () {
    var id = $('releaseSound').value;
    if (id && soundMap[id]) playSoundUrl(soundMap[id].url);
  };
  $('trimSound').onclick = async function () {
    var id = $('trimSource').value;
    if (!id || !soundMap[id]) {
      $('message').textContent = '先选中一个音效';
      return;
    }
    var start = Number($('trimStart').value);
    var end = Number($('trimEnd').value);
    if (!(end > start)) {
      $('message').textContent = '结束时间必须大于开始时间';
      return;
    }
    $('message').textContent = '解码音频…';
    try {
      var ab = await fetch(soundMap[id].url).then(function (r) { return r.arrayBuffer(); });
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      var buffer = await ctx.decodeAudioData(ab.slice(0));
      var s = Math.max(0, Math.min(buffer.duration, start));
      var e = Math.max(s, Math.min(buffer.duration, end));
      if (e - s < 0.05) {
        $('message').textContent = '裁剪区间太短';
        ctx.close();
        return;
      }
      var blob = encodeWav(buffer, s, e);
      var name = '裁剪-' + (soundMap[id].name || '音效') + '.wav';
      var r = await fetch('/sounds/import?name=' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: blob
      });
      var d = await r.json();
      ctx.close();
      if (d.ok) {
        await loadSounds();
        $('trimSource').value = d.sound.id;
        $('message').textContent = '裁剪完成，可在下拉中选择，点保存生效';
      } else {
        $('message').textContent = '裁剪保存失败：' + (d.error || '');
      }
    } catch (err) {
      $('message').textContent = '裁剪失败：' + errText(err);
    }
  };

  /* ---------------- 读取 / 保存 ---------------- */
  async function loadStatus() {
    try {
      var res = await fetch('/status');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var st = await res.json();
      showStatus(st);
      applyAccountStatus(st.accounts);
    } catch (error) {
      $('status').textContent = '状态读取失败：' + errText(error);
    }
  }
  async function load() {
    settingsReady = false;
    loadFailed = false;
    $('save').disabled = true;
    try {
      var res = await fetch('/settings/data');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var d = await res.json();
      if (!d || typeof d !== 'object') throw new Error('返回内容不是 JSON');
      maxAccounts = Number(d.maxAccounts) || 10;
      defaultBalanceUrl = d.defaultBalanceUrl || '';
      $('refreshSec').value = d.refreshSec;
      $('alertThreshold').value = d.alertThreshold;
      $('autoReturnEnabled').checked = d.autoReturnEnabled !== false;
      $('autoReturnDelaySec').value = d.autoReturnDelaySec;
      $('petSize').value = d.petSize;
      $('bubbleScale').value = d.bubbleScale;
      $('bubbleFontSize').value = d.bubbleFontSize;
      $('chatBaseUrl').value = d.chatBaseUrl || '';
      $('chatModel').value = d.chatModel || '';
      $('chatPrompt').value = d.chatPrompt || '';
      $('chatKeyState').textContent = d.hasChatConfigKey
        ? '已保存对话专用 key'
        : (d.hasChatKey ? '复用账户 key' : '未配置');
      renderAccounts(Array.isArray(d.accounts) ? d.accounts : []);
      try { await loadSounds(); } catch (error) { /* 音效列表失败不影响设置编辑 */ }
      await loadStatus();
    } catch (error) {
      loadFailed = true;
      $('accountSummary').textContent = '账户读取失败';
      $('message').textContent = '读取设置失败：' + errText(error) + '。本次保存不会提交账户列表。';
    } finally {
      // 读取失败也要恢复可编辑和保存按钮，避免页面卡死
      settingsReady = true;
      $('save').disabled = false;
    }
  }

  $('save').onclick = async function () {
    if (!settingsReady || saving) return;
    saving = true;
    $('save').disabled = true;
    $('message').textContent = '保存中…';
    var body = {
      refreshSec: Number($('refreshSec').value),
      alertThreshold: Number($('alertThreshold').value),
      autoReturnEnabled: $('autoReturnEnabled').checked,
      autoReturnDelaySec: Number($('autoReturnDelaySec').value),
      petSize: Number($('petSize').value),
      bubbleScale: Number($('bubbleScale').value),
      bubbleFontSize: Number($('bubbleFontSize').value),
      clickPressSound: $('pressSound').value,
      clickReleaseSound: $('releaseSound').value,
      clickSound: $('pressSound').value,
      chatBaseUrl: $('chatBaseUrl').value,
      chatModel: $('chatModel').value,
      chatApiKey: $('chatApiKey').value,
      clearChatApiKey: $('clearChatKey').checked,
      chatPrompt: $('chatPrompt').value
    };
    // 账户读取失败时不提交账户列表，避免把服务器上已有的账户误删
    if (!loadFailed) body.accounts = collectAccounts();
    try {
      var res = await fetch('/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      var d = null;
      try { d = await res.json(); } catch (error) { d = null; }
      if (!res.ok || !d || !d.ok) {
        throw new Error((d && d.error) || ('HTTP ' + res.status));
      }
      $('chatApiKey').value = '';
      $('clearChatKey').checked = false;
      var note = '已保存';
      if (Array.isArray(d.warnings) && d.warnings.length) note += '（' + d.warnings.join('；') + '）';
      await load();
      $('message').textContent = note;
    } catch (error) {
      $('message').textContent = '保存失败：' + errText(error);
    } finally {
      saving = false;
      $('save').disabled = !settingsReady;
    }
  };

  $('resetReturnAnchor').onclick = async function () {
    $('message').textContent = '正在恢复…';
    try {
      var res = await fetch('/return-anchor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clear: true })
      });
      var d = await res.json().catch(function () { return null; });
      if (!res.ok || !d || !d.ok) throw new Error((d && d.error) || ('HTTP ' + res.status));
      $('message').textContent = '已恢复默认窗口回归位置';
    } catch (error) {
      $('message').textContent = '恢复失败：' + errText(error);
    }
  };

  $('refresh').onclick = async function () {
    if (saving) return;
    $('refresh').disabled = true;
    $('message').textContent = '刷新中…';
    try {
      await fetch('/refresh', { method: 'POST' });
      await loadStatus();
      $('message').textContent = '已刷新余额';
    } catch (error) {
      $('message').textContent = '刷新失败：' + errText(error);
    } finally {
      $('refresh').disabled = false;
    }
  };
  $('clearSpent').onclick = async function () {
    if (!settingsReady || saving) return;
    if (!confirm('确定清除今日已用记录？')) return;
    $('clearSpent').disabled = true;
    $('message').textContent = '清除中…';
    try {
      var r = await fetch('/ledger/clear', { method: 'POST' });
      var d = await r.json();
      $('message').textContent = d.ok ? '今日已用已清零' : '清除失败';
      if (d.ok) await loadStatus();
    } catch (error) {
      $('message').textContent = '清除失败：' + errText(error);
    } finally {
      $('clearSpent').disabled = false;
    }
  };
  $('close').onclick = function () { window.close(); };
  load();
</script>
</body>
</html>`;

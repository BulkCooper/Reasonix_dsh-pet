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
  .sound-list { border: 1px solid #e6ebf4; border-radius: 10px; padding: 8px 12px; max-height: 190px; overflow: auto; }
  .sound-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-weight: 400; }
  .sound-row input[type=radio] { width: auto; }
  .sound-row span { flex: 1; font-size: 13px; }
  .sound-row button { padding: 4px 10px; font-size: 12px; }
  .trim { margin-top: 10px; }
  .trim .row { margin-top: 8px; }
  #soundFile { display: none; }
  .account-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; font-size: 13px; }
  .account-value { color: #4b7bec; }
  input[type=text], textarea { width: 100%; padding: 10px 12px; border: 1px solid #d9dee8; border-radius: 8px; font-size: 14px; outline: none; font-family: inherit; }
  textarea { resize: vertical; line-height: 1.5; }
  .account-row input[type=checkbox] { width: auto; flex: 0 0 auto; }
  .account-row input.account-name { flex: 1; width: auto; padding: 4px 8px; font-size: 13px; }
  .account-row .account-value { flex: 0 0 auto; }
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

  <h2>双击音效</h2>
  <p class="sub">选中一个音效作为双击音效；也可以导入本地音频并裁剪。保存后下一次双击立即使用。</p>
  <div id="sounds" class="sound-list">加载中…</div>
  <div class="row">
    <input id="soundFile" type="file" accept="audio/*">
    <button id="importSound" class="secondary">导入音频…</button>
    <button id="previewSound" class="secondary">试听选中</button>
  </div>
  <div class="trim">
    <label for="trimStart">裁剪起止（秒）</label>
    <div class="row">
      <input id="trimStart" type="number" min="0" step="0.01" value="0" placeholder="开始">
      <input id="trimEnd" type="number" min="0" step="0.01" placeholder="结束">
      <button id="trimSound" class="secondary">裁剪并保存</button>
    </div>
    <div class="hint">起止时间按选中音效的实际时长填写；裁剪结果会保存为 WAV 自定义音效。</div>
  </div>

  <div class="row">
    <button id="save">保存</button>
    <button id="refresh" class="secondary">立即刷新余额</button>
    <button id="close" class="secondary">关闭</button>
  </div>
  <div id="message"></div>

  <h2>对话 API</h2>
  <p class="sub">桌宠右键「对话 / 碎碎念」使用这个 OpenAI 兼容接口。API Key 留空会复用余额 key 或 .env 的 DEEPSEEK_API_KEY。</p>
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

  <h2>账户</h2>
  <div id="accounts" class="sound-list">加载中…</div>
  <div class="hint">勾选要显示在余额气泡中的账户；名字留空使用默认名称。</div>

  <h2>当前状态</h2>
  <pre id="status">加载中…</pre>
</div>
<script>
  var $ = function (id) { return document.getElementById(id); };
  function showStatus(data) {
    $('status').textContent = JSON.stringify(data, null, 2);
  }
  var soundMap = {};
  function selectedSoundId() {
    var el = document.querySelector('input[name=clickSound]:checked');
    return el ? el.value : '';
  }
  function selectSound(id) {
    var radios = document.querySelectorAll('input[name=clickSound]');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].value === id) radios[i].checked = true;
    }
  }
  function playSoundUrl(url) {
    try {
      var audio = new Audio(url);
      audio.volume = 0.85;
      audio.play().catch(function () {});
    } catch (e) {}
  }
  async function loadSounds() {
    var r = await fetch('/sounds');
    var d = await r.json();
    soundMap = {};
    var box = $('sounds');
    box.innerHTML = '';
    d.sounds.forEach(function (sound) {
      soundMap[sound.id] = sound;
      var row = document.createElement('label');
      row.className = 'sound-row';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'clickSound';
      radio.value = sound.id;
      radio.checked = sound.id === d.selected;
      var name = document.createElement('span');
      name.textContent = sound.name + (sound.builtin ? '（内置）' : '');
      var play = document.createElement('button');
      play.type = 'button';
      play.className = 'secondary';
      play.textContent = '试听';
      play.onclick = function (e) {
        e.preventDefault();
        playSoundUrl(sound.url);
      };
      row.appendChild(radio);
      row.appendChild(name);
      row.appendChild(play);
      box.appendChild(row);
    });
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
      selectSound(d.sound.id);
      $('message').textContent = '已导入「' + d.sound.name + '」，点保存生效';
    } else {
      $('message').textContent = '导入失败：' + (d.error || '');
    }
    $('soundFile').value = '';
  };
  $('previewSound').onclick = function () {
    var id = selectedSoundId();
    if (id && soundMap[id]) playSoundUrl(soundMap[id].url);
  };
  $('trimSound').onclick = async function () {
    var id = selectedSoundId();
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
        selectSound(d.sound.id);
        $('message').textContent = '裁剪完成，点保存生效';
      } else {
        $('message').textContent = '裁剪保存失败：' + (d.error || '');
      }
    } catch (err) {
      $('message').textContent = '裁剪失败：' + (err && err.message ? err.message : err);
    }
  };
  function renderAccounts(accounts) {
    var box = $('accounts');
    box.innerHTML = '';
    if (!accounts.length) {
      box.textContent = '未发现账户';
      return;
    }
    accounts.forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'account-row';
      var check = document.createElement('input');
      check.type = 'checkbox';
      check.name = 'accountVisible';
      check.value = a.id;
      check.checked = a.visible !== false;
      var name = document.createElement('input');
      name.type = 'text';
      name.className = 'account-name';
      name.name = 'accountName';
      name.setAttribute('data-id', a.id);
      name.value = a.customName || '';
      name.placeholder = a.defaultName || a.name || '';
      var val = document.createElement('span');
      val.className = 'account-value';
      if (a.status === 'ok') val.textContent = '¥' + Number(a.total).toFixed(2) + ' ' + (a.currency || '');
      else if (a.status === 'no-balance-api') val.textContent = '无余额接口';
      else if (a.status === 'no-key') val.textContent = '未配置 key';
      else val.textContent = '查询失败';
      row.appendChild(check);
      row.appendChild(name);
      row.appendChild(val);
      box.appendChild(row);
    });
  }
  async function load() {
    var r = await fetch('/settings/data');
    var d = await r.json();
    $('refreshSec').value = d.refreshSec;
    $('alertThreshold').value = d.alertThreshold;
    $('keyState').textContent = d.hasConfigKey
      ? '已保存到插件配置'
      : (d.hasEnvKey ? '当前使用环境变量 / .env 中的 DEEPSEEK_API_KEY' : '未配置 key');
    $('chatBaseUrl').value = d.chatBaseUrl;
    $('chatModel').value = d.chatModel;
    $('chatPrompt').value = d.chatPrompt;
    $('chatKeyState').textContent = d.hasChatConfigKey
      ? '已保存到插件配置'
      : (d.hasChatKey ? '使用余额 key / .env' : '未配置');
    var s = await fetch('/status');
    try { await loadSounds(); } catch (e) {}
    var st = await s.json();
    showStatus(st);
    renderAccounts(st.accounts || []);
  }
  $('save').onclick = async function () {
    var body = {
      apiKey: $('apiKey').value,
      clearApiKey: $('clearKey').checked,
      refreshSec: Number($('refreshSec').value),
      alertThreshold: Number($('alertThreshold').value),
      clickSound: selectedSoundId(),
      chatBaseUrl: $('chatBaseUrl').value,
      chatModel: $('chatModel').value,
      chatApiKey: $('chatApiKey').value,
      clearChatApiKey: $('clearChatKey').checked,
      chatPrompt: $('chatPrompt').value,
      accountVisibility: (function () {
        var map = {};
        var inputs = document.querySelectorAll('input[name=accountVisible]');
        for (var i = 0; i < inputs.length; i++) map[inputs[i].value] = inputs[i].checked;
        return map;
      })(),
      accountNames: (function () {
        var map = {};
        var inputs = document.querySelectorAll('input[name=accountName]');
        for (var i = 0; i < inputs.length; i++) map[inputs[i].getAttribute('data-id')] = inputs[i].value;
        return map;
      })()
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
      $('chatApiKey').value = '';
      $('clearChatKey').checked = false;
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

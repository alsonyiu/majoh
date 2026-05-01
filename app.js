/* ============================================================
 * 主程式 app.js - UI / 狀態管理 / 流程控制
 * ============================================================ */

(function () {
  'use strict';

  // ---------- 狀態 ----------
  const STORAGE_KEY = 'mj_state_v1';
  const DEFAULTS = {
    settings: {
      ruleSet: 'canto',
      base: 1,
      minFan: 3,
      maxFan: 13,
      zimoDouble: false,
      apiKey: '',
      model: 'gemini-2.0-flash',
      playerNames: ['玩家 1', '玩家 2', '玩家 3', '玩家 4'],
    },
    game: null, // 當前牌局
    history: [], // 過往牌局
    lastRecognition: null, // 最近一次影相結果(俾「寫入今鋪」用)
  };

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return mergeDefaults(s, DEFAULTS);
      }
    } catch (e) { /* ignore */ }
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
  }
  function mergeDefaults(s, d) {
    const out = JSON.parse(JSON.stringify(d));
    if (s && typeof s === 'object') {
      for (const k of Object.keys(s)) {
        if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && d[k]) {
          out[k] = { ...out[k], ...s[k] };
        } else if (s[k] !== undefined) {
          out[k] = s[k];
        }
      }
    }
    return out;
  }

  // ---------- DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function toast(msg, ms = 2200) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------- Tab 導航 ----------
  function switchTab(tabId) {
    $$('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    const titles = { 'tab-score': '計分', 'tab-camera': '影相計番', 'tab-history': '記錄', 'tab-settings': '設定' };
    $('#header-title').textContent = titles[tabId] || '麻雀計番';
  }

  // ---------- 設定 ----------
  function renderSettings() {
    const s = state.settings;
    // Rule seg
    $$('.seg-control[data-setting="rules"] .seg').forEach(b => {
      b.classList.toggle('active', b.dataset.value === s.ruleSet);
    });
    $('#set-base').value = s.base;
    $('#set-min-fan').value = s.minFan;
    $('#set-max-fan').value = s.maxFan;
    $('#set-zimo-double').checked = !!s.zimoDouble;
    $('#set-api-key').value = s.apiKey || '';
    $('#set-model').value = s.model || 'gemini-2.0-flash';

    // 玩家名
    const wrap = $('#player-names-rows');
    wrap.innerHTML = '';
    s.playerNames.forEach((name, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span>玩家 ${i + 1}</span><input type="text" data-pidx="${i}" value="${escapeHtml(name)}" />`;
      wrap.appendChild(row);
    });

    // Header badge & unit labels
    updateRuleBadgeAndLabels();
  }

  function updateRuleBadgeAndLabels() {
    const r = state.settings.ruleSet;
    const def = MJ.DEFAULT_RULES[r];
    $('#rule-badge').textContent = def.name;
    $$('.unit-label').forEach(el => el.textContent = def.unit);
    $('#fan-unit').textContent = def.unit;
  }

  function bindSettings() {
    $$('.seg-control[data-setting="rules"] .seg').forEach(b => {
      b.addEventListener('click', () => {
        state.settings.ruleSet = b.dataset.value;
        // 切換規則時更新預設 min/max
        const def = MJ.DEFAULT_RULES[state.settings.ruleSet];
        if (state.settings.minFan < 1) state.settings.minFan = def.minWin;
        if (state.settings.maxFan < state.settings.minFan) state.settings.maxFan = def.max;
        saveState();
        renderSettings();
        toast(`已切換到${def.name}`);
      });
    });

    $('#set-base').addEventListener('change', e => {
      state.settings.base = Math.max(0.1, +e.target.value || 1);
      saveState();
    });
    $('#set-min-fan').addEventListener('change', e => {
      state.settings.minFan = Math.max(0, +e.target.value | 0);
      saveState();
    });
    $('#set-max-fan').addEventListener('change', e => {
      state.settings.maxFan = Math.max(1, +e.target.value | 0);
      saveState();
    });
    $('#set-zimo-double').addEventListener('change', e => {
      state.settings.zimoDouble = e.target.checked;
      saveState();
    });
    $('#set-api-key').addEventListener('change', e => {
      state.settings.apiKey = e.target.value.trim();
      saveState();
    });
    $('#set-model').addEventListener('change', e => {
      state.settings.model = e.target.value;
      saveState();
    });

    $('#player-names-rows').addEventListener('change', e => {
      if (e.target.matches('input[data-pidx]')) {
        const i = +e.target.dataset.pidx;
        state.settings.playerNames[i] = e.target.value || `玩家 ${i + 1}`;
        saveState();
        renderScoreBoard();
      }
    });

    $('#btn-test-api').addEventListener('click', async () => {
      const out = $('#api-test-result');
      out.textContent = '測試中…';
      try {
        const res = await Vision.testApi(state.settings.apiKey, state.settings.model);
        out.style.color = '#1aa264';
        out.textContent = '✓ 通:' + res.slice(0, 50);
      } catch (e) {
        out.style.color = '#d6404a';
        out.textContent = '✗ ' + e.message;
      }
    });

    $('#btn-clear-data').addEventListener('click', () => {
      if (confirm('真係要清晒所有設定同記錄?')) {
        localStorage.removeItem(STORAGE_KEY);
        state = JSON.parse(JSON.stringify(DEFAULTS));
        renderAll();
        toast('已清除');
      }
    });
  }

  // ---------- 計分版 ----------
  function renderScoreBoard() {
    const empty = $('#score-empty'), board = $('#score-board');
    if (!state.game) {
      empty.classList.remove('hidden'); board.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden'); board.classList.remove('hidden');

    const g = state.game;
    $('#game-round-label').textContent = `${windName(g.prevailingWind)} 局 · 莊:${state.settings.playerNames[g.dealerIdx]}`;
    $('#game-hand-count').textContent = `${g.rounds.length} 鋪`;

    // Player cards
    const grid = $('#players-grid'); grid.innerHTML = '';
    const totals = computeTotals(g);
    for (let i = 0; i < 4; i++) {
      const card = document.createElement('div');
      card.className = 'player-card';
      if (i === g.dealerIdx) card.classList.add('dealer');
      const total = totals[i];
      const sign = total > 0 ? 'positive' : (total < 0 ? 'negative' : '');
      card.innerHTML = `
        <div class="player-wind">${windName(seatWindOf(i, g.dealerIdx))}</div>
        <div class="player-name">${escapeHtml(state.settings.playerNames[i])}</div>
        <div class="player-score ${sign}">${formatMoney(total)}</div>
      `;
      grid.appendChild(card);
    }

    // Rounds list
    const list = $('#rounds-list'); list.innerHTML = '';
    g.rounds.slice().reverse().forEach((r, idxRev) => {
      const idx = g.rounds.length - 1 - idxRev;
      const row = document.createElement('div');
      row.className = 'round-row';
      const def = MJ.DEFAULT_RULES[g.ruleSet || state.settings.ruleSet];
      let info = '';
      if (r.type === 'draw') info = '流局';
      else if (r.type === 'zimo') info = `${state.settings.playerNames[r.winnerIdx]} 自摸`;
      else info = `${state.settings.playerNames[r.winnerIdx]} 食 ${state.settings.playerNames[r.loserIdx]}`;
      row.innerHTML = `
        <div class="round-info">
          <div>${idx + 1}. ${info}</div>
          <div class="round-meta">${r.fan} ${def.unit}${r.flowers ? ` · 花×${r.flowers}` : ''}</div>
        </div>
        <div class="round-fan">${r.fan > 0 ? formatMoney(maxAbsPayment(r.payments)) : '—'}</div>
      `;
      list.appendChild(row);
    });
  }

  function windName(w) { return ({ E: '東', S: '南', W: '西', N: '北' })[w] || w; }
  function seatWindOf(playerIdx, dealerIdx) {
    const winds = ['E', 'S', 'W', 'N'];
    return winds[(playerIdx - dealerIdx + 4) % 4];
  }
  function computeTotals(g) {
    const totals = [0, 0, 0, 0];
    for (const r of g.rounds) {
      for (let i = 0; i < 4; i++) totals[i] += r.payments[i] || 0;
    }
    return totals;
  }
  function formatMoney(n) {
    const sign = n > 0 ? '+' : '';
    return sign + (Math.round(n * 100) / 100);
  }
  function maxAbsPayment(arr) {
    let max = 0;
    for (const v of arr || []) if (Math.abs(v) > Math.abs(max)) max = v;
    return Math.abs(max);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // ---------- 計番 → 銀碼 ----------
  // 標準 HK 雙倍制:
  //   每番超過起糊一番,雙倍。即係 base * 2^(fan - minFan)
  //   超過上限 capped
  function fanToBaseUnit(fan, settings) {
    const f = Math.max(settings.minFan, Math.min(fan, settings.maxFan));
    const exp = f - settings.minFan;
    return settings.base * Math.pow(2, exp);
  }

  function calcPayments({ type, winnerIdx, loserIdx, fan, flowers, dealerIdx, settings }) {
    const payments = [0, 0, 0, 0];
    if (type === 'draw') return payments;
    const totalFan = fan + (flowers || 0);
    const unit = fanToBaseUnit(totalFan, settings);
    if (type === 'win') {
      // 食糊:放炮者賠
      payments[loserIdx] -= unit;
      payments[winnerIdx] += unit;
    } else if (type === 'zimo') {
      // 自摸:三家齊出 (預設);自摸雙計再 ×2
      const zimoMul = settings.zimoDouble ? 2 : 1;
      const each = unit * zimoMul;
      for (let i = 0; i < 4; i++) {
        if (i !== winnerIdx) {
          payments[i] -= each;
          payments[winnerIdx] += each;
        }
      }
    }
    return payments;
  }

  // ---------- 新一局 ----------
  function openNewGameModal() {
    const inputs = $('#new-game-players');
    inputs.innerHTML = '';
    state.settings.playerNames.forEach((n, i) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = n;
      inp.dataset.pidx = i;
      inp.placeholder = `玩家 ${i + 1}`;
      inputs.appendChild(inp);
    });

    // Dealer picker
    const pick = $('#ng-dealer'); pick.innerHTML = '';
    state.settings.playerNames.forEach((n, i) => {
      const b = document.createElement('button');
      b.dataset.idx = i;
      b.textContent = n;
      if (i === 0) b.classList.add('active');
      b.addEventListener('click', () => {
        $$('#ng-dealer button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
      pick.appendChild(b);
    });

    // Wind seg
    $$('#ng-prevailing .seg').forEach(b => b.classList.toggle('active', b.dataset.value === 'E'));

    openModal('modal-new-game');
  }

  function startNewGame() {
    // 收集
    $$('#new-game-players input').forEach(inp => {
      const i = +inp.dataset.pidx;
      state.settings.playerNames[i] = inp.value.trim() || `玩家 ${i + 1}`;
    });
    const prevailing = ($$('#ng-prevailing .seg.active')[0] || {}).dataset?.value || 'E';
    const dealerIdx = +($$('#ng-dealer button.active')[0] || {}).dataset?.idx || 0;

    // 如果有未完結牌局,存入 history
    if (state.game && state.game.rounds.length > 0) {
      state.history.unshift({
        ...state.game,
        endedAt: Date.now(),
        finalTotals: computeTotals(state.game)
      });
      if (state.history.length > 50) state.history = state.history.slice(0, 50);
    }

    state.game = {
      ruleSet: state.settings.ruleSet,
      prevailingWind: prevailing,
      dealerIdx,
      rounds: [],
      startedAt: Date.now(),
    };
    saveState();
    closeModal();
    renderScoreBoard();
    renderHistory();
    toast('新一局開始');
  }

  // ---------- 加一鋪 ----------
  let handDraft = null;
  function openAddHandModal() {
    if (!state.game) { toast('請先開新一局'); return; }
    handDraft = {
      type: 'win',
      winnerIdx: 0,
      loserIdx: 1,
      fan: state.settings.minFan,
      flowers: 0,
    };
    // Render player picks
    const pickW = $('#pick-winner'); pickW.innerHTML = '';
    const pickL = $('#pick-loser'); pickL.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const bw = document.createElement('button');
      bw.dataset.idx = i;
      bw.textContent = state.settings.playerNames[i];
      if (i === handDraft.winnerIdx) bw.classList.add('active');
      bw.addEventListener('click', () => {
        handDraft.winnerIdx = i;
        $$('#pick-winner button').forEach(x => x.classList.toggle('active', +x.dataset.idx === i));
        if (handDraft.loserIdx === i) {
          handDraft.loserIdx = (i + 1) % 4;
          $$('#pick-loser button').forEach(x => x.classList.toggle('active', +x.dataset.idx === handDraft.loserIdx));
        }
        updatePaymentPreview();
      });
      pickW.appendChild(bw);

      const bl = document.createElement('button');
      bl.dataset.idx = i;
      bl.textContent = state.settings.playerNames[i];
      if (i === handDraft.loserIdx) bl.classList.add('active');
      bl.addEventListener('click', () => {
        if (i === handDraft.winnerIdx) { toast('放炮者唔可以係自己'); return; }
        handDraft.loserIdx = i;
        $$('#pick-loser button').forEach(x => x.classList.toggle('active', +x.dataset.idx === i));
        updatePaymentPreview();
      });
      pickL.appendChild(bl);
    }

    $$('#hand-type .seg').forEach(b => b.classList.toggle('active', b.dataset.value === 'win'));
    $('#hand-fan').value = state.settings.minFan;
    $('#hand-flowers').value = 0;
    showHandFields();
    updatePaymentPreview();
    openModal('modal-add-hand');
  }

  function showHandFields() {
    const t = handDraft.type;
    $('#field-winner').classList.toggle('hidden', t === 'draw');
    $('#field-loser').classList.toggle('hidden', t !== 'win');
    $('#field-fan').classList.toggle('hidden', t === 'draw');
    $('#field-flowers').classList.toggle('hidden', t === 'draw');
    $('#payment-preview').classList.toggle('hidden', t === 'draw');
  }

  function updatePaymentPreview() {
    if (handDraft.type === 'draw') return;
    const p = calcPayments({
      ...handDraft,
      dealerIdx: state.game.dealerIdx,
      settings: state.settings,
    });
    const def = MJ.DEFAULT_RULES[state.settings.ruleSet];
    const totalFan = handDraft.fan + (handDraft.flowers || 0);
    const unit = fanToBaseUnit(totalFan, state.settings);
    let html = `<div class="pay-row"><span>每注 (${totalFan} ${def.unit})</span><span>${formatMoney(unit)}</span></div>`;
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) continue;
      const cls = p[i] > 0 ? 'win' : 'lose';
      html += `<div class="pay-row"><span>${escapeHtml(state.settings.playerNames[i])}</span><span class="pay-amount ${cls}">${formatMoney(p[i])}</span></div>`;
    }
    $('#payment-preview').innerHTML = html;
  }

  function bindAddHand() {
    $$('#hand-type .seg').forEach(b => {
      b.addEventListener('click', () => {
        handDraft.type = b.dataset.value;
        $$('#hand-type .seg').forEach(x => x.classList.toggle('active', x === b));
        showHandFields();
        updatePaymentPreview();
      });
    });
    $('#hand-fan').addEventListener('input', e => {
      handDraft.fan = Math.max(0, +e.target.value | 0);
      updatePaymentPreview();
    });
    $('#hand-flowers').addEventListener('input', e => {
      handDraft.flowers = Math.max(0, +e.target.value | 0);
      updatePaymentPreview();
    });
    $('#btn-fan-from-camera').addEventListener('click', () => {
      const r = state.lastRecognition;
      if (!r || !r.fanResult) { toast('未有影相結果。請先去「影相」'); return; }
      $('#hand-fan').value = r.fanResult.total;
      handDraft.fan = r.fanResult.total;
      updatePaymentPreview();
      toast(`已套用 ${r.fanResult.total} ${MJ.DEFAULT_RULES[state.settings.ruleSet].unit}`);
    });
    $('#btn-confirm-hand').addEventListener('click', () => {
      const t = handDraft.type;
      if (t === 'win' && handDraft.winnerIdx === handDraft.loserIdx) {
        toast('食糊者同放炮者唔可以係同一個'); return;
      }
      const payments = (t === 'draw') ? [0, 0, 0, 0] : calcPayments({
        ...handDraft, dealerIdx: state.game.dealerIdx, settings: state.settings
      });
      const round = {
        type: t,
        winnerIdx: t === 'draw' ? null : handDraft.winnerIdx,
        loserIdx: t === 'win' ? handDraft.loserIdx : null,
        fan: t === 'draw' ? 0 : handDraft.fan,
        flowers: t === 'draw' ? 0 : handDraft.flowers,
        payments,
        timestamp: Date.now(),
      };
      state.game.rounds.push(round);
      // 自動轉莊:如果非莊家糊或流局
      if (t === 'draw' || (t !== 'draw' && handDraft.winnerIdx !== state.game.dealerIdx)) {
        // 留番俾用戶手動處理,簡化版唔自動轉
      }
      saveState();
      closeModal();
      renderScoreBoard();
      toast('已加入');
    });
  }

  function undoLastHand() {
    if (!state.game || state.game.rounds.length === 0) { toast('冇嘢可撤回'); return; }
    if (!confirm('撤回最後一鋪?')) return;
    state.game.rounds.pop();
    saveState();
    renderScoreBoard();
  }

  // ---------- Modal ----------
  function openModal(id) { $('#' + id).classList.remove('hidden'); }
  function closeModal() { $$('.modal').forEach(m => m.classList.add('hidden')); }
  function bindModals() {
    $$('[data-close-modal]').forEach(b => b.addEventListener('click', closeModal));
    $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModal(); }));
  }

  // ---------- 影相 ----------
  function bindCamera() {
    $('#photo-input').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      $('#photo-preview').src = url;
      $('#photo-preview-wrap').classList.remove('hidden');
      $('#photo-status').textContent = '識別中… (Gemini)';
      $('#recognized-tiles').classList.add('hidden');
      $('#fan-result').classList.add('hidden');

      try {
        if (!state.settings.apiKey) {
          throw new Error('未設定 API key,去「設定」入面填好佢先');
        }
        const recog = await Vision.recognizeTiles(f, state.settings.apiKey, state.settings.model);
        $('#photo-status').textContent = `識別完成 (信心:${recog.confidence})`;
        showRecognizedAndScore(recog);
      } catch (err) {
        $('#photo-status').textContent = '識別失敗:' + err.message;
        toast('識別失敗,可以試「示範牌」或者手動修正');
      }
    });

    $('#btn-demo-tiles').addEventListener('click', () => {
      const demo = Vision.DEMO_HANDS[Math.floor(Math.random() * Vision.DEMO_HANDS.length)];
      $('#photo-preview-wrap').classList.add('hidden');
      const recog = {
        tiles: demo.state.tiles,
        melds: demo.state.melds || [],
        flowers: demo.state.flowers || [],
        winningTile: demo.state.winningTile,
        isZimo: demo.state.isZimo,
        seatWind: demo.state.seatWind,
        prevailingWind: demo.state.prevailingWind,
        confidence: 'demo',
        demoName: demo.name,
      };
      showRecognizedAndScore(recog);
      toast('示範牌:' + demo.name);
    });

    $('#btn-edit-tiles').addEventListener('click', () => {
      const r = state.lastRecognition;
      if (!r) return;
      $('#tiles-text').value = r.recognized.tiles.map(t => t).join(' ');
      $('#tiles-winning').value = r.recognized.winningTile || '';
      $('#tiles-zimo').checked = !!r.recognized.isZimo;
      openModal('modal-edit-tiles');
    });

    $('#btn-recalc').addEventListener('click', () => {
      const tiles = MJ.parseTilesFromText($('#tiles-text').value);
      const winningTile = MJ.parseTilesFromText($('#tiles-winning').value)[0];
      const isZimo = $('#tiles-zimo').checked;
      if (tiles.length === 0) { toast('讀唔到任何牌'); return; }
      const recog = {
        tiles,
        melds: [],
        flowers: tiles.filter(t => MJ.isFlowerTile(t)),
        winningTile: winningTile || tiles[tiles.length - 1],
        isZimo,
        confidence: 'manual',
      };
      // 由 tiles 入面拎走 flowers
      recog.tiles = tiles.filter(t => !MJ.isFlowerTile(t));
      closeModal();
      showRecognizedAndScore(recog);
    });

    $('#btn-apply-to-game').addEventListener('click', () => {
      if (!state.game) {
        if (confirm('未開新一局,而家開?')) {
          openNewGameModal();
        }
        return;
      }
      switchTab('tab-score');
      openAddHandModal();
      // 預填番數
      const r = state.lastRecognition;
      if (r && r.fanResult) {
        $('#hand-fan').value = r.fanResult.total;
        handDraft.fan = r.fanResult.total;
        $('#hand-flowers').value = r.recognized.flowers.length;
        handDraft.flowers = r.recognized.flowers.length;
        updatePaymentPreview();
      }
    });
  }

  function showRecognizedAndScore(recog) {
    // 顯示牌
    const $row = $('#tiles-display'); $row.innerHTML = '';
    const sorted = MJ.sortTiles(recog.tiles);
    for (const t of sorted) {
      const el = document.createElement('span');
      el.className = 'tile';
      if (MJ.isHonorTile(t)) el.classList.add('honor');
      if (MJ.isFlowerTile(t)) el.classList.add('flower');
      if (t === recog.winningTile) el.classList.add('winning');
      el.textContent = MJ.TILE_DISPLAY[t] || t;
      $row.appendChild(el);
    }
    // 副露
    if (recog.melds && recog.melds.length > 0) {
      for (const m of recog.melds) {
        const wrap = document.createElement('span');
        wrap.style.marginLeft = '6px';
        wrap.style.borderLeft = '2px solid #888';
        wrap.style.paddingLeft = '6px';
        for (const t of m.tiles) {
          const el = document.createElement('span');
          el.className = 'tile';
          if (MJ.isHonorTile(t)) el.classList.add('honor');
          el.textContent = MJ.TILE_DISPLAY[t] || t;
          wrap.appendChild(el);
        }
        $row.appendChild(wrap);
      }
    }
    // 花
    if (recog.flowers && recog.flowers.length > 0) {
      const wrap = document.createElement('span');
      wrap.style.marginLeft = '8px';
      for (const t of recog.flowers) {
        const el = document.createElement('span');
        el.className = 'tile flower';
        el.textContent = MJ.TILE_DISPLAY[t] || t;
        wrap.appendChild(el);
      }
      $row.appendChild(wrap);
    }

    $('#tiles-meta').textContent = `共 ${recog.tiles.length} 張` +
      (recog.winningTile ? ` · 食糊張:${MJ.TILE_DISPLAY[recog.winningTile] || recog.winningTile}` : '') +
      (recog.isZimo ? ' · 自摸' : '') +
      (recog.demoName ? ` · ${recog.demoName}` : '');
    $('#recognized-tiles').classList.remove('hidden');

    // 計番:確保食糊張喺 tiles 入面
    const seatWind = recog.seatWind || (state.game ? seatWindOf(0, state.game.dealerIdx) : 'E');
    const prevailingWind = recog.prevailingWind || (state.game ? state.game.prevailingWind : 'E');
    const tilesIncluding = recog.tiles.includes(recog.winningTile)
      ? recog.tiles.slice()
      : [...recog.tiles, recog.winningTile];
    const result = MJ.calculate({
      tiles: tilesIncluding,
      melds: recog.melds || [],
      flowers: recog.flowers || [],
      winningTile: recog.winningTile,
      isZimo: !!recog.isZimo,
      seatWind, prevailingWind,
    }, { ruleSet: state.settings.ruleSet });

    renderFanResult(result);

    state.lastRecognition = { recognized: recog, fanResult: result };
    saveState();
  }

  function renderFanResult(result) {
    const def = MJ.DEFAULT_RULES[state.settings.ruleSet];
    $('#fan-total').textContent = result.total;
    $('#fan-unit').textContent = def.unit;
    $('#fan-status').textContent = result.status +
      (result.total >= state.settings.minFan ? ` · 夠糊 (起糊 ${state.settings.minFan} ${def.unit})` :
        ` · 唔夠糊 (起糊 ${state.settings.minFan} ${def.unit})`);
    const ul = $('#fan-breakdown'); ul.innerHTML = '';
    if (result.items.length === 0) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="fb-name">${escapeHtml(result.status)}</span>`;
      ul.appendChild(li);
    }
    for (const it of result.items) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div>
          <div class="fb-name">${escapeHtml(it.name)}</div>
          ${it.desc ? `<div class="fb-desc">${escapeHtml(it.desc)}</div>` : ''}
        </div>
        <div class="fb-fan">${it.fan} ${def.unit}</div>
      `;
      ul.appendChild(li);
    }
    $('#fan-result').classList.remove('hidden');
  }

  // ---------- 記錄 ----------
  function renderHistory() {
    const list = $('#history-list');
    if (!state.history || state.history.length === 0) {
      list.innerHTML = '<div class="empty-state small">仲未有任何完結嘅牌局</div>';
      return;
    }
    list.innerHTML = '';
    state.history.forEach((g, idx) => {
      const card = document.createElement('div');
      card.className = 'history-card';
      const date = new Date(g.endedAt || g.startedAt).toLocaleString('zh-HK');
      const def = MJ.DEFAULT_RULES[g.ruleSet];
      const totals = g.finalTotals || computeTotals(g);
      const sorted = totals.map((v, i) => ({ name: state.settings.playerNames[i], v }))
        .sort((a, b) => b.v - a.v);
      card.innerHTML = `
        <div class="hc-title">${date} · ${def.name} · ${g.rounds.length} 鋪</div>
        <div class="hc-meta">
          ${sorted.map(s => `${escapeHtml(s.name)}: ${formatMoney(s.v)}`).join(' · ')}
        </div>
      `;
      list.appendChild(card);
    });
  }

  // ---------- 初始 / 綁事件 ----------
  function bindNav() {
    $$('.nav-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  }

  function bindMain() {
    $('#btn-new-game').addEventListener('click', openNewGameModal);
    $('#btn-add-hand').addEventListener('click', openAddHandModal);
    $('#btn-undo-hand').addEventListener('click', undoLastHand);
    $('#btn-game-menu').addEventListener('click', () => {
      const choices = [
        '1. 開新一局 (記錄歸 0,舊局歸檔)',
        '2. 改莊家',
        '3. 改圈風',
        '4. 取消',
      ].join('\n');
      const c = prompt(choices, '4');
      if (c === '1') openNewGameModal();
      else if (c === '2') {
        const i = +prompt('做莊嘅玩家(0-3):', state.game.dealerIdx);
        if (i >= 0 && i < 4) { state.game.dealerIdx = i; saveState(); renderScoreBoard(); }
      } else if (c === '3') {
        const w = (prompt('圈風 (E/S/W/N):', state.game.prevailingWind) || 'E').toUpperCase();
        if (['E', 'S', 'W', 'N'].includes(w)) { state.game.prevailingWind = w; saveState(); renderScoreBoard(); }
      }
    });
    $('#btn-start-game').addEventListener('click', startNewGame);
  }

  function renderAll() {
    renderSettings();
    renderScoreBoard();
    renderHistory();
    updateRuleBadgeAndLabels();
  }

  // ---------- PWA 註冊 service worker ----------
  function registerSW() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW reg failed', e));
    }
  }

  function init() {
    bindNav();
    bindSettings();
    bindMain();
    bindModals();
    bindAddHand();
    bindCamera();
    renderAll();
    registerSW();

    // 預設 tab
    switchTab('tab-score');
  }

  document.addEventListener('DOMContentLoaded', init);
})();

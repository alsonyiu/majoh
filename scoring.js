/* ============================================================
 * 麻雀計番引擎 - scoring.js
 *
 * 牌張寫法 (key):
 *   1m - 9m : 萬子
 *   1p - 9p : 筒子
 *   1s - 9s : 索子
 *   E  S  W  N : 風牌 東南西北
 *   C  F  P : 三元牌 (中 / 發 / 白)
 *   f1-f4 : 春夏秋冬 (花)
 *   s1-s4 : 梅蘭菊竹 (季)
 *
 * 主要 API:
 *   MJ.calculate(state, opts) -> { total, items, status, decomp }
 *
 * state = {
 *   tiles: string[],         // 手牌(包食糊張),不含已碰/槓嘅張
 *   melds: Meld[],           // 已副露(碰/槓/吃)
 *   flowers: string[],       // 花/季
 *   winningTile: string,     // 食糊張
 *   isZimo: bool,
 *   isDealer: bool,
 *   prevailingWind: 'E'|'S'|'W'|'N',
 *   seatWind: 'E'|'S'|'W'|'N',
 *   isLastTile: bool,        // 海底/河底
 *   isAfterKong: bool,       // 槓上開花
 *   isRobKong: bool,         // 搶槓
 * }
 * Meld = { type:'chi'|'pung'|'kong', tiles:string[], concealed?:bool }
 *
 * opts = { ruleSet:'canto'|'taiwan' }
 * ============================================================ */

(function (global) {
  'use strict';

  // ---------- Helper: 牌張處理 ----------
  const NUMBER_SUITS = ['m', 'p', 's'];
  const WINDS = ['E', 'S', 'W', 'N'];
  const DRAGONS = ['C', 'F', 'P'];
  const HONORS = [...WINDS, ...DRAGONS];

  const TILE_DISPLAY = {
    '1m': '一萬', '2m': '二萬', '3m': '三萬', '4m': '四萬', '5m': '五萬',
    '6m': '六萬', '7m': '七萬', '8m': '八萬', '9m': '九萬',
    '1p': '一筒', '2p': '二筒', '3p': '三筒', '4p': '四筒', '5p': '五筒',
    '6p': '六筒', '7p': '七筒', '8p': '八筒', '9p': '九筒',
    '1s': '一索', '2s': '二索', '3s': '三索', '4s': '四索', '5s': '五索',
    '6s': '六索', '7s': '七索', '8s': '八索', '9s': '九索',
    'E': '東', 'S': '南', 'W': '西', 'N': '北',
    'C': '中', 'F': '發', 'P': '白',
    'f1': '春', 'f2': '夏', 'f3': '秋', 'f4': '冬',
    's1': '梅', 's2': '蘭', 's3': '菊', 's4': '竹',
  };

  const TILE_SHORT = {
    '1m': '一m', '2m': '二m', '3m': '三m', '4m': '四m', '5m': '五m',
    '6m': '六m', '7m': '七m', '8m': '八m', '9m': '九m',
    '1p': '一p', '2p': '二p', '3p': '三p', '4p': '四p', '5p': '五p',
    '6p': '六p', '7p': '七p', '8p': '八p', '9p': '九p',
    '1s': '一s', '2s': '二s', '3s': '三s', '4s': '四s', '5s': '五s',
    '6s': '六s', '7s': '七s', '8s': '八s', '9s': '九s',
    'E': '東', 'S': '南', 'W': '西', 'N': '北',
    'C': '中', 'F': '發', 'P': '白',
    'f1': '春', 'f2': '夏', 'f3': '秋', 'f4': '冬',
    's1': '梅', 's2': '蘭', 's3': '菊', 's4': '竹',
  };

  function isNumberTile(t) { return t && /^[1-9][mps]$/.test(t); }
  function isHonorTile(t) { return HONORS.includes(t); }
  function isWindTile(t) { return WINDS.includes(t); }
  function isDragonTile(t) { return DRAGONS.includes(t); }
  function isFlowerTile(t) { return /^[fs][1-4]$/.test(t); }
  function isTerminal(t) { return /^[19][mps]$/.test(t); }
  function isYaochuu(t) { return isTerminal(t) || isHonorTile(t); }
  function suitOf(t) { return isNumberTile(t) ? t[1] : null; }
  function numOf(t) { return isNumberTile(t) ? +t[0] : null; }

  function tileSortKey(t) {
    if (isNumberTile(t)) {
      const sIdx = NUMBER_SUITS.indexOf(t[1]);
      return sIdx * 100 + (+t[0]);
    }
    if (isWindTile(t)) return 300 + WINDS.indexOf(t);
    if (isDragonTile(t)) return 400 + DRAGONS.indexOf(t);
    if (isFlowerTile(t)) return 500 + (t[0] === 'f' ? 0 : 4) + (+t[1]);
    return 999;
  }
  function sortTiles(tiles) { return [...tiles].sort((a, b) => tileSortKey(a) - tileSortKey(b)); }

  function countTiles(tiles) {
    const c = {};
    for (const t of tiles) c[t] = (c[t] || 0) + 1;
    return c;
  }

  // ---------- 標準結構分解 ----------
  // 喺 (tiles, sets needed) 入面搵晒所有 (sets) 嘅可行 decomposition
  // tiles 必須係已經抽走 pair 嘅手牌 counts
  function findAllSetCombos(counts, needed) {
    if (needed === 0) {
      for (const k in counts) if (counts[k] > 0) return [];
      return [[]];
    }
    // 搵第一隻有牌嘅 tile
    const keys = Object.keys(counts).sort((a, b) => tileSortKey(a) - tileSortKey(b));
    let firstTile = null;
    for (const k of keys) if (counts[k] > 0) { firstTile = k; break; }
    if (!firstTile) return [];

    const results = [];

    // 試 Pung
    if (counts[firstTile] >= 3) {
      counts[firstTile] -= 3;
      const subs = findAllSetCombos(counts, needed - 1);
      counts[firstTile] += 3;
      for (const sub of subs) {
        results.push([{ type: 'pung', tiles: [firstTile, firstTile, firstTile], concealed: true }, ...sub]);
      }
    }
    // 試 Chi
    if (isNumberTile(firstTile)) {
      const n = numOf(firstTile), s = suitOf(firstTile);
      if (n <= 7) {
        const t2 = `${n + 1}${s}`, t3 = `${n + 2}${s}`;
        if ((counts[t2] || 0) > 0 && (counts[t3] || 0) > 0) {
          counts[firstTile]--; counts[t2]--; counts[t3]--;
          const subs = findAllSetCombos(counts, needed - 1);
          counts[firstTile]++; counts[t2]++; counts[t3]++;
          for (const sub of subs) {
            results.push([{ type: 'chi', tiles: [firstTile, t2, t3], concealed: true }, ...sub]);
          }
        }
      }
    }
    return results;
  }

  // 將 hand tiles 拆做 (pair + sets) 嘅所有可能
  function findStandardDecompositions(handTiles, setsNeeded) {
    const counts = countTiles(handTiles);
    const decomps = [];
    const tried = new Set();
    for (const t of Object.keys(counts)) {
      if (tried.has(t)) continue; tried.add(t);
      if (counts[t] >= 2) {
        counts[t] -= 2;
        const setCombos = findAllSetCombos(counts, setsNeeded);
        counts[t] += 2;
        for (const sets of setCombos) {
          decomps.push({ pair: t, sets });
        }
      }
    }
    return decomps;
  }

  // ---------- 特殊和(非標準結構) ----------
  function isThirteenOrphans(tiles14) {
    if (tiles14.length !== 14) return false;
    const required = ['1m', '9m', '1p', '9p', '1s', '9s', 'E', 'S', 'W', 'N', 'C', 'F', 'P'];
    const c = countTiles(tiles14);
    let pairFound = false;
    for (const t of required) {
      if (!c[t]) return false;
      if (c[t] === 2) {
        if (pairFound) return false;
        pairFound = true;
      } else if (c[t] !== 1) return false;
    }
    return pairFound;
  }

  function isSevenPairs(tiles14) {
    if (tiles14.length !== 14) return false;
    const c = countTiles(tiles14);
    let pairs = 0;
    for (const k of Object.keys(c)) {
      if (c[k] === 2) pairs++;
      else if (c[k] === 4) pairs += 2; // 四張當兩對(部分規則)
      else return false;
    }
    return pairs === 7;
  }

  function isNineGates(tiles14, exposedMelds, winningTile) {
    if (exposedMelds && exposedMelds.length > 0) return false;
    if (tiles14.length !== 14) return false;
    // 全部同色,且 1112345678999 + 一隻
    const suits = new Set();
    for (const t of tiles14) {
      if (!isNumberTile(t)) return false;
      suits.add(suitOf(t));
    }
    if (suits.size !== 1) return false;
    const s = [...suits][0];
    const c = countTiles(tiles14);
    // 至少要有: 1×3, 2-8 各 1, 9×3 = 共 13 張,加食糊張 = 14
    // 等於話: 移走食糊張之後, 應該係 1112345678999
    const removed = { ...c };
    removed[winningTile] = (removed[winningTile] || 0) - 1;
    const need = { [`1${s}`]: 3, [`9${s}`]: 3 };
    for (let i = 2; i <= 8; i++) need[`${i}${s}`] = 1;
    for (const k of Object.keys(need)) if ((removed[k] || 0) !== need[k]) return false;
    return true;
  }

  // ---------- 牌組屬性偵測 ----------
  function isPungSet(set) { return set.type === 'pung' || set.type === 'kong'; }
  function isChiSet(set) { return set.type === 'chi'; }

  function isHonorOnlyTile(t) { return isHonorTile(t); }
  function isTerminalOrHonorSet(set) {
    return set.tiles.every(t => isYaochuu(t));
  }

  function suitOfSet(set) {
    const t = set.tiles[0];
    if (isNumberTile(t)) return suitOf(t);
    return 'z'; // honor
  }

  // ---------- 主計番函式 ----------
  function calculate(state, opts) {
    opts = opts || { ruleSet: 'canto' };
    const ruleSet = opts.ruleSet || 'canto';
    const setsNeeded = ruleSet === 'taiwan' ? 5 : 4;
    const handSize = ruleSet === 'taiwan' ? 17 : 14; // 包食糊張

    // 1) 整理輸入
    const exposedMelds = (state.melds || []).map(m => ({
      type: m.type, tiles: [...m.tiles], concealed: !!m.concealed
    }));
    const tiles = sortTiles(state.tiles || []);
    const flowers = state.flowers || [];
    const winningTile = state.winningTile;
    const expectedHand = handSize - exposedMelds.reduce((a, m) => a + (m.type === 'kong' ? 4 : 3), 0);

    if (tiles.length !== expectedHand) {
      return {
        total: 0, items: [], decomp: null,
        status: `牌數唔啱:應該手牌 ${expectedHand} 張,而家有 ${tiles.length} 張`
      };
    }
    if (!winningTile || !tiles.includes(winningTile)) {
      return {
        total: 0, items: [], decomp: null,
        status: `要指定食糊張`
      };
    }

    // 2) 試各種糊牌結構
    const candidates = [];

    // 標準結構
    const decomps = findStandardDecompositions(tiles, setsNeeded - exposedMelds.length);
    for (const d of decomps) {
      const allSets = [...exposedMelds, ...d.sets];
      candidates.push({ kind: 'standard', pair: d.pair, sets: allSets });
    }

    // 十三么
    if (ruleSet === 'canto' && exposedMelds.length === 0 && isThirteenOrphans(tiles)) {
      candidates.push({ kind: 'thirteenOrphans' });
    }
    // 七對(廣東通常唔承認;台牌或可選承認 — 預設唔開)
    // if (ruleSet === 'taiwan' && exposedMelds.length === 0 && isSevenPairs(tiles)) {...}

    // 九子連環 (清一色 + 1112345678999 形)
    if (ruleSet === 'canto' && isNineGates(tiles, exposedMelds, winningTile)) {
      candidates.push({ kind: 'nineGates' });
    }

    if (candidates.length === 0) {
      return { total: 0, items: [], decomp: null, status: '呢手牌唔係糊牌結構' };
    }

    // 3) 計每個候選結構嘅番,揀最高
    let best = null;
    for (const c of candidates) {
      const r = scoreCandidate(c, state, ruleSet);
      if (!best || r.total > best.total) best = r;
    }

    return best;
  }

  // ---------- 分數計算 ----------
  function scoreCandidate(cand, state, ruleSet) {
    const items = [];
    const flowers = state.flowers || [];
    const seatWind = state.seatWind || 'E';
    const prevailingWind = state.prevailingWind || 'E';

    const ruleTbl = ruleSet === 'taiwan' ? CANTO : CANTO; // both call same name table; 用 ruleSet 喺度切換番數
    const T = ruleSet === 'taiwan' ? TAIWAN : CANTO;

    function add(name, fan, desc) {
      if (fan > 0) items.push({ name, fan, desc: desc || '' });
    }

    // ---- Limit hands (大牌) ----
    if (cand.kind === 'thirteenOrphans') {
      add('十三么', T.thirteenOrphans, '13 種么九各一,其中一張成對');
      // 加自摸/門前清/花
      addAuxiliaryFan(items, state, ruleSet, T, true);
      return finalize(items, ruleSet, cand);
    }
    if (cand.kind === 'nineGates') {
      add('九子連環', T.nineGates, '清一色 1112345678999 + 任一張');
      addAuxiliaryFan(items, state, ruleSet, T, true);
      return finalize(items, ruleSet, cand);
    }

    // ---- 標準結構 ----
    const sets = cand.sets;
    const pair = cand.pair;
    const allTiles = [...sets.flatMap(s => s.tiles), pair, pair];
    const isAllConcealed = sets.every(s => s.concealed);

    // 副露係咪有 (即係未必係門前清)
    const hasExposed = sets.some(s => !s.concealed);

    // ---- 對對糊 ----
    const allPungs = sets.every(s => isPungSet(s));
    if (allPungs) add('對對糊', T.allTriplets, '全部係刻子/槓子');

    // ---- 平糊 (全順子,且雀頭非番牌) ----
    // 嚴格平糊: 全副露順子 + 對為非番牌 + 兩面聽食糊(此處簡化為前兩條)
    const allChis = sets.every(s => isChiSet(s));
    const pairIsValueable = isDragonTile(pair) ||
      (isWindTile(pair) && (pair === seatWind || pair === prevailingWind));
    if (ruleSet === 'canto' && allChis && !pairIsValueable) {
      add('平糊', T.allChi, '全部順子,雀頭非番牌');
    } else if (ruleSet === 'taiwan' && allChis && !pairIsValueable) {
      add('平胡', T.allChi, '全部順子,雀頭非番牌');
    }

    // ---- 暗刻數 (台牌) ----
    if (ruleSet === 'taiwan') {
      const concealedPungs = sets.filter(s => isPungSet(s) && s.concealed).length;
      if (concealedPungs >= 3) {
        const map = { 3: ['三暗刻', T.threeConcealed], 4: ['四暗刻', T.fourConcealed], 5: ['五暗刻', T.fiveConcealed] };
        const e = map[concealedPungs];
        if (e) add(e[0], e[1], `${concealedPungs} 個暗刻`);
      }
    }

    // ---- 一色相關 ----
    const usedSuits = new Set();
    let hasHonor = false;
    for (const t of allTiles) {
      if (isNumberTile(t)) usedSuits.add(suitOf(t));
      else if (isHonorTile(t)) hasHonor = true;
    }
    if (usedSuits.size === 0 && hasHonor) {
      add('字一色', T.allHonors, '齋字牌 (限制糊)');
    } else if (usedSuits.size === 1 && !hasHonor) {
      add('清一色', T.fullFlush, '單一花色,冇字牌');
    } else if (usedSuits.size === 1 && hasHonor) {
      add('混一色', T.halfFlush, '單一花色 + 字牌');
    }

    // ---- 三元/四喜 ----
    const dragonPungs = sets.filter(s => isPungSet(s) && isDragonTile(s.tiles[0]));
    const dragonPair = isDragonTile(pair) ? pair : null;
    if (dragonPungs.length === 3) {
      add('大三元', T.bigThreeDragons, '中發白齊刻');
    } else if (dragonPungs.length === 2 && dragonPair) {
      add('小三元', T.smallThreeDragons, '兩刻三元 + 一對三元');
    } else {
      // 單個三元刻子 = 番牌
      for (const s of dragonPungs) {
        const name = TILE_DISPLAY[s.tiles[0]];
        add(`${name}刻`, T.dragonPung, `${name} 三元牌刻`);
      }
    }

    const windPungs = sets.filter(s => isPungSet(s) && isWindTile(s.tiles[0]));
    const windPair = isWindTile(pair) ? pair : null;
    if (windPungs.length === 4) {
      add('大四喜', T.bigFourWinds, '東南西北齊刻');
    } else if (windPungs.length === 3 && windPair) {
      add('小四喜', T.smallFourWinds, '三風刻 + 一風對');
    } else {
      // 個別風刻 (圈/門風)
      for (const s of windPungs) {
        const w = s.tiles[0];
        if (w === seatWind) add('門風刻', T.seatWind, `自己門風 ${TILE_DISPLAY[w]}`);
        if (w === prevailingWind) add('圈風刻', T.prevailingWind, `當圈 ${TILE_DISPLAY[w]}`);
      }
    }

    // ---- 一條龍 / 三色同順 / 三色同刻 (主要係台牌,廣東有時都計) ----
    if (ruleSet === 'taiwan' || ruleSet === 'canto') {
      // 一條龍: 同色 1-9 三順子 (123, 456, 789)
      for (const suit of NUMBER_SUITS) {
        const need = [[1, 2, 3], [4, 5, 6], [7, 8, 9]].map(arr => arr.map(n => `${n}${suit}`));
        const found = need.every(triple =>
          sets.some(s => isChiSet(s) && s.tiles[0] === triple[0] && s.tiles[1] === triple[1] && s.tiles[2] === triple[2])
        );
        if (found) {
          add('一條龍', T.straight, `${suit === 'm' ? '萬' : suit === 'p' ? '筒' : '索'}子 1-9`);
          break;
        }
      }
      // 三色同順: 同 num 起首順子 三色都有
      for (let n = 1; n <= 7; n++) {
        const has = NUMBER_SUITS.every(s =>
          sets.some(set => isChiSet(set) && set.tiles[0] === `${n}${s}`)
        );
        if (has) {
          add('三色同順', T.mixedTripleChi, `${n}${n + 1}${n + 2} 三色`);
          break;
        }
      }
      // 三色同刻
      for (let n = 1; n <= 9; n++) {
        const has = NUMBER_SUITS.every(s =>
          sets.some(set => isPungSet(set) && set.tiles[0] === `${n}${s}`)
        );
        if (has) {
          add('三色同刻', T.mixedTriplePung, `三色 ${n} 刻子`);
          break;
        }
      }
    }

    // ---- 全帶么 / 混老頭 / 清老頭 ----
    const allYaochuu = allTiles.every(t => isYaochuu(t));
    if (allYaochuu && hasHonor && usedSuits.size > 0) {
      add('混老頭', T.terminalsHonors, '全部係么九 + 字');
    } else if (allYaochuu && !hasHonor) {
      add('清老頭', T.allTerminals, '齋么九,冇字');
    }

    // ---- 輔助番(門清/自摸/花/槓上/海底/搶槓) ----
    addAuxiliaryFan(items, state, ruleSet, T, false, isAllConcealed);

    return finalize(items, ruleSet, cand);
  }

  function addAuxiliaryFan(items, state, ruleSet, T, isLimit, isAllConcealed) {
    function add(name, fan, desc) { if (fan > 0) items.push({ name, fan, desc: desc || '' }); }
    // 自摸
    if (state.isZimo) add('自摸', T.zimo, '自己摸糊');
    // 門前清 (冇副露;嚴格定義唔包暗槓未必算副露)
    if (isAllConcealed && !state.isZimo) {
      add('門前清', T.menzenchin, '冇副露');
    }
    if (isAllConcealed && state.isZimo) {
      // 廣東: 門清 + 自摸 = 額外 1 番;台牌:門清自摸合共 3 台 (已加自摸 1,再加門清 1 + 不求人 1)
      if (ruleSet === 'taiwan') {
        add('不求人', T.menzenZimoBonus, '門清 + 自摸');
      } else {
        add('門前清', T.menzenchin, '冇副露,自摸糊');
      }
    }
    // 花/季
    const flowers = state.flowers || [];
    const seatIdx = ['E', 'S', 'W', 'N'].indexOf(state.seatWind || 'E');
    let flowerFan = 0;
    let flowerDesc = [];
    for (const f of flowers) {
      flowerFan += T.eachFlower;
      flowerDesc.push(TILE_DISPLAY[f]);
      // 合自家花/季
      if ((f === 'f' + (seatIdx + 1) || f === 's' + (seatIdx + 1))) {
        // 已經喺 each flower 1 番包咗
      }
    }
    if (flowerFan > 0) add('花/季', flowerFan, flowerDesc.join('、'));
    // 全花 (春夏秋冬齊)
    const fF = ['f1', 'f2', 'f3', 'f4'].every(x => flowers.includes(x));
    const sS = ['s1', 's2', 's3', 's4'].every(x => flowers.includes(x));
    if (fF) add('齊春夏秋冬', T.fullFlowerSet, '');
    if (sS) add('齊梅蘭菊竹', T.fullFlowerSet, '');

    if (state.isAfterKong) add('槓上開花', T.afterKong, '');
    if (state.isLastTile && !state.isZimo) add('河底撈魚', T.lastDiscard, '');
    if (state.isLastTile && state.isZimo) add('海底撈月', T.lastDraw, '');
    if (state.isRobKong) add('搶槓和', T.robKong, '');
  }

  function finalize(items, ruleSet, decomp) {
    const total = items.reduce((a, x) => a + x.fan, 0);
    const status = items.length > 0 ? '糊牌' : '未夠番';
    return { total, items, status, decomp, ruleSet };
  }

  // ---------- 番數表 ----------
  // 廣東牌(港式舊章)
  const CANTO = {
    // 限制糊
    thirteenOrphans: 13,
    nineGates: 13,
    bigFourWinds: 13,
    bigThreeDragons: 8,
    allHonors: 10,
    fullFlush: 7,
    halfFlush: 3,
    smallFourWinds: 6,
    smallThreeDragons: 5,
    allTerminals: 13,
    terminalsHonors: 4,
    // 順/刻組合
    allTriplets: 3,
    allChi: 1,           // 平糊
    straight: 1,         // 一條龍
    mixedTripleChi: 1,   // 三色同順
    mixedTriplePung: 2,  // 三色同刻
    // 暗刻 (廣東通常唔特別計)
    threeConcealed: 0,
    fourConcealed: 0,
    fiveConcealed: 0,
    // 番牌
    dragonPung: 1,
    seatWind: 1,
    prevailingWind: 1,
    // 輔助
    zimo: 1,
    menzenchin: 1,
    menzenZimoBonus: 0,
    eachFlower: 1,
    fullFlowerSet: 1,
    afterKong: 1,
    lastDiscard: 1,
    lastDraw: 1,
    robKong: 1,
  };

  // 港式台牌(16 張,以「台」為單位)
  const TAIWAN = {
    thirteenOrphans: 0, // 16 張通常冇十三么
    nineGates: 0,
    bigFourWinds: 16,
    bigThreeDragons: 8,
    allHonors: 16,
    fullFlush: 8,
    halfFlush: 4,
    smallFourWinds: 8,
    smallThreeDragons: 4,
    allTerminals: 16,
    terminalsHonors: 4,
    allTriplets: 4,        // 碰碰胡
    allChi: 2,             // 平胡
    straight: 4,
    mixedTripleChi: 4,
    mixedTriplePung: 8,
    threeConcealed: 2,
    fourConcealed: 5,
    fiveConcealed: 8,
    dragonPung: 1,
    seatWind: 2,
    prevailingWind: 2,
    zimo: 1,
    menzenchin: 1,
    menzenZimoBonus: 1,
    eachFlower: 1,
    fullFlowerSet: 2,
    afterKong: 1,
    lastDiscard: 1,
    lastDraw: 1,
    robKong: 1,
  };

  // ---------- 公開 API ----------
  global.MJ = {
    calculate,
    parseTilesFromText,
    TILE_DISPLAY,
    TILE_SHORT,
    isNumberTile, isHonorTile, isFlowerTile,
    sortTiles,
    DEFAULT_RULES: {
      canto: { name: '廣東牌', unit: '番', minWin: 3, max: 13, base: 1 },
      taiwan: { name: '港式台牌', unit: '台', minWin: 5, max: 24, base: 1 },
    },
  };

  // ---------- Text parsing for manual edit ----------
  // 接受用空格/逗號分隔, 可以 "1m 2m 3m" 或 "1m,2m,3m" 或 "東 南"
  function parseTilesFromText(s) {
    if (!s) return [];
    const tokens = s.replace(/[,，、；;]/g, ' ').split(/\s+/).filter(Boolean);
    const out = [];
    for (let tk of tokens) {
      tk = tk.trim();
      // 處理中文
      const map = {
        '東': 'E', '南': 'S', '西': 'W', '北': 'N',
        '中': 'C', '紅中': 'C', '發': 'F', '青發': 'F', '白': 'P', '白板': 'P',
        '春': 'f1', '夏': 'f2', '秋': 'f3', '冬': 'f4',
        '梅': 's1', '蘭': 's2', '菊': 's3', '竹': 's4',
      };
      if (map[tk]) { out.push(map[tk]); continue; }
      const lower = tk.toLowerCase();
      if (/^[1-9][mps]$/.test(lower)) { out.push(lower); continue; }
      if (/^[esnwcfp]$/i.test(tk)) { out.push(tk.toUpperCase()); continue; }
      if (/^[fs][1-4]$/.test(lower)) { out.push(lower); continue; }
      // 中文數字 + suit 例如 "三萬", "五筒", "九索"
      const cnNum = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
      const m = tk.match(/^([一二三四五六七八九])(萬|筒|索|m|p|s)$/);
      if (m) {
        const n = cnNum[m[1]];
        const sx = { '萬': 'm', '筒': 'p', '索': 's', 'm': 'm', 'p': 'p', 's': 's' }[m[2]];
        out.push(`${n}${sx}`);
        continue;
      }
      // skip unknown
    }
    return out;
  }

})(typeof window !== 'undefined' ? window : globalThis);

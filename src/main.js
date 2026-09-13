// 인생 RPG 시스템 — 메인 앱 로직
// (claude.ai 아티팩트에서 만든 것을 독립 프로젝트로 옮긴 버전)

import { installStorageShim } from './lib/storageShim.js';
import { getApiKey, setApiKey, hasApiKey } from './lib/apiKey.js';

installStorageShim();

const root = document.getElementById('life-rpg-root');

  const GEMINI_MODEL = 'gemini-3.6-flash';
  const STATS = [
    { key: 'STR', name: '활력', color: 'var(--str)' },
    { key: 'INT', name: '지력', color: 'var(--int)' },
    { key: 'CRE', name: '창의', color: 'var(--cre)' },
    { key: 'CHA', name: '소셜', color: 'var(--cha)' },
    { key: 'WIS', name: '멘탈', color: 'var(--wis)' },
    { key: 'GLD', name: '자원', color: 'var(--gld)' },
  ];
  const PROMOTE_THRESHOLD = 3;
  const MAX_LEVEL_DISPLAY = 30;
  const TIER_STARTS = [1, 7, 13, 19, 25]; // 5 tiers across Lv.1~30

  const WIZARD_STEPS = [
    { key: 'job', type: 'text', q: '지금 어떤 일을 하고 계세요?', sub: '직업, 전공, 지금 하는 일을 알려주세요 — 지력/창의 퀘스트를 여기에 맞춰 만들어요', ph: '예: 그래픽 디자이너, 취업 준비 중' },
    { key: 'exercise', type: 'choice', q: '운동 습관은 어떤가요?', options: ['거의 안 함', '가끔 한다', '규칙적으로 한다', '매우 활발하다'] },
    { key: 'learning', type: 'choice', q: '책·새로운 지식을 얼마나 자주 접하나요?', options: ['거의 안 함', '가끔', '자주', '매일 습관처럼'] },
    { key: 'creative', type: 'choice', q: '창작·작업 활동은 얼마나 하시나요?', options: ['거의 안 함', '가끔', '자주', '매일 한다'] },
    { key: 'social', type: 'choice', q: '커리어 관련 네트워킹(연락, 공유, 이메일 등)은 어떤 편인가요?', options: ['거의 안 함', '가끔 한다', '자주 한다', '적극적으로 한다'] },
    { key: 'mental', type: 'choice', q: '스트레스 관리나 나만의 휴식 시간은?', options: ['거의 없음', '가끔 챙긴다', '루틴이 있다', '잘 관리하는 편'] },
    { key: 'finance', type: 'choice', q: '재정 관리 습관은 어떤가요?', options: ['전혀 안 함', '가끔 확인', '꾸준히 기록', '체계적으로 관리'] },
    { key: 'weakStat', type: 'multi', q: '6개 영역 중 신경 쓰고 싶은 건? (복수 선택 가능)', sub: '하나 이상 고르면 그 영역 루틴을 더 알차게 짜줘요', options: ['활력 STR', '지력 INT', '창의 CRE', '소셜 CHA', '멘탈 WIS', '자원 GLD'] },
    { key: 'goal', type: 'text', q: '요즘 가장 신경 쓰는 목표는?', sub: '있다면 구체적으로 — 이걸 바탕으로 서브퀘스트를 만들어줘요', ph: '예: 포트폴리오 사이트 완성', optional: true },
  ];

  let character = null;
  let questPool = null;
  let weeklyQuests = null;
  let routine = null;
  let overdrive = null;
  let dailyStatus = null;
  let subQuests = null;
  let promotionDismissed = null;
  let tierAck = null; // { STR: 1, INT: 1, ... } tier the CURRENT routine content is calibrated to
  let tierNoticeDismissed = null; // { STR: lastTierNoticeShownFor, ... }
  let tierRewardGiven = null; // { STR: highestTierRewarded, ... }
  let skipTokens = null; // { STR: count, ... }
  let badges = null; // [{id, stat, tier, label, date}]
  let log = null;
  let aiSuggestions = [];
  let lastMemoText = '';
  let lastErrorDetail = '';

  function classifyAiError(e) {
    const msg = String((e && e.message) || e || '');
    if (msg === 'NO_API_KEY') return 'nokey';
    if (/\b(401|403)\b|UNAUTHENTICATED|PERMISSION_DENIED|API key not valid|ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(msg)) return 'keyerror';
    return 'error';
  }
  let aiState = 'idle';
  let onboardState = 'idle';
  let tierRegenState = {}; // { STR: 'loading'|'error' }

  let wizardOpen = false;
  let wizardStep = 0;
  let wizardAnswers = {};
  let wizardMultiTemp = [];
  let adminMode = false;

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function weekKey() {
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - day);
    return monday.getFullYear() + '-' + String(monday.getMonth()+1).padStart(2,'0') + '-' + String(monday.getDate()).padStart(2,'0');
  }
  function daysUntilSunday() {
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    return 6 - day;
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function daysUntil(dateStr) {
    const a = new Date(todayKey()), b = new Date(dateStr);
    return Math.round((b - a) / 86400000);
  }
  function tierFor(level) {
    let t = 1;
    for (let i = 0; i < TIER_STARTS.length; i++) if (level >= TIER_STARTS[i]) t = i + 1;
    return t;
  }
  function xpNeeded(level) { return Math.round(100 * Math.pow(1.35, level - 1)); }
  function daysSince(dateStr) {
    if (!dateStr) return 99;
    const a = new Date(dateStr), b = new Date(todayKey());
    return Math.round((b - a) / 86400000);
  }

  async function loadAll() {
    character = await safeGet('character', () => {
      const stats = {};
      STATS.forEach(s => stats[s.key] = { level: 0, xp: 0, lastActive: null });
      return { stats };
    });
    questPool = await safeGet('questPool', () => { const pool = {}; STATS.forEach(s => pool[s.key] = []); return pool; });
    weeklyQuests = await safeGet('weeklyQuests', () => []);
    routine = await safeGet('routine', () => { const r = {}; STATS.forEach(s => r[s.key] = []); return r; });
    overdrive = await safeGet('overdrive', () => { const o = {}; STATS.forEach(s => o[s.key] = []); return o; });
    dailyStatus = await safeGet('dailyStatus', () => ({ date: todayKey(), done: [] }));
    subQuests = await safeGet('subQuests', () => []);
    promotionDismissed = await safeGet('promotionDismissed', () => []);
    tierAck = await safeGet('tierAck', () => { const t = {}; STATS.forEach(s => t[s.key] = 1); return t; });
    tierNoticeDismissed = await safeGet('tierNoticeDismissed', () => { const t = {}; STATS.forEach(s => t[s.key] = 0); return t; });
    tierRewardGiven = await safeGet('tierRewardGiven', () => { const t = {}; STATS.forEach(s => t[s.key] = 1); return t; });
    skipTokens = await safeGet('skipTokens', () => { const t = {}; STATS.forEach(s => t[s.key] = 0); return t; });
    badges = await safeGet('badges', () => []);
    log = await safeGet('log', () => []);

    wizardOpen = STATS.every(s => routine[s.key].length === 0 && overdrive[s.key].length === 0);

    rolloverWeekly();
    ensureDailyStatus();
    render();
  }

  async function safeGet(key, fallback) {
    try {
      const res = await window.storage.get(key, false);
      return res ? JSON.parse(res.value) : fallback();
    } catch (e) { return fallback(); }
  }
  async function save(key, value, _retry) {
    try {
      await window.storage.set(key, JSON.stringify(value), false);
    } catch (e) {
      if (!_retry) {
        await new Promise(r => setTimeout(r, 400));
        return save(key, value, true);
      }
      console.error('storage save failed', key, e);
    }
  }

  async function callAI(system, userContent, maxTokens, fallbackText) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('NO_API_KEY');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.9 }
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('API_ERROR ' + res.status + ': ' + errText.slice(0, 200));
    }
    const data = await res.json();
    const cand = data && data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text;
    return (text || fallbackText || '').replace(/```json|```/g, '').trim();
  }

  const DECAY_THRESHOLD = 3; // 방치 며칠부터 레벨 하락
  const TIER_BONUS_EXP = [0, 25, 40, 60, 80, 100]; // index = tier

  function ensureDailyStatus() {
    if (dailyStatus.date !== todayKey()) {
      runDailyMaintenance();
      dailyStatus = { date: todayKey(), done: [] };
      save('dailyStatus', dailyStatus);
    }
  }

  async function runDailyMaintenance() {
    let changed = false;
    STATS.forEach(s => {
      const st = character.stats[s.key];
      if (!st.lastActive) return; // 아직 한 번도 시작 안 한 스탯은 방치 판정 대상이 아님
      const d = daysSince(st.lastActive);
      if (d >= DECAY_THRESHOLD) {
        if ((skipTokens[s.key] || 0) > 0) {
          skipTokens[s.key] -= 1;
          st.lastActive = todayKey();
          log.unshift({ date: todayKey(), stat: s.key, exp: 0, name: '스킵권 사용 — 레벨 하락 방지' });
          changed = true;
        } else if (st.level > 0) {
          st.level -= 1;
          st.xp = 0;
          st.lastActive = todayKey();
          log.unshift({ date: todayKey(), stat: s.key, exp: 0, name: '루틴 방치로 레벨 하락 (Lv.' + (st.level + 1) + ' → Lv.' + st.level + ')' });
          changed = true;
        }
      }
    });
    if (changed) {
      await save('character', character);
      await save('skipTokens', skipTokens);
      await save('log', log);
    }
  }

  function tierNerfFactor(statKey) {
    const behind = Math.max(0, tierFor(character.stats[statKey].level) - (tierAck[statKey] || 1));
    return Math.max(0.5, 1 - 0.15 * behind);
  }

  async function checkTierRewards(statKey) {
    const st = character.stats[statKey];
    const reachedTier = tierFor(st.level);
    let given = tierRewardGiven[statKey] || 1;
    const statName = STATS.find(s => s.key === statKey).name;
    while (given < reachedTier) {
      given += 1;
      const bonus = TIER_BONUS_EXP[given] || 100;
      st.xp += bonus;
      while (st.xp >= xpNeeded(st.level)) { st.xp -= xpNeeded(st.level); st.level += 1; }
      skipTokens[statKey] = (skipTokens[statKey] || 0) + (given >= 4 ? 2 : 1);
      badges.push({ id: 'b' + Date.now() + Math.random(), stat: statKey, tier: given, label: statName + ' 티어 ' + given + ' 진입', date: todayKey() });
      log.unshift({ date: todayKey(), stat: statKey, exp: bonus, name: statName + ' 티어 ' + given + ' 진입 보너스' });
      showToast('🎉 ' + statName + ' 티어 ' + given + ' 진입! 보너스 +' + bonus + ' · 스킵권 지급');
    }
    if (given !== tierRewardGiven[statKey]) {
      tierRewardGiven[statKey] = given;
      await save('tierRewardGiven', tierRewardGiven);
      await save('skipTokens', skipTokens);
      await save('badges', badges);
    }
  }

  async function addXp(statKey, amount, questName) {
    const st = character.stats[statKey];
    st.xp += amount;
    st.lastActive = todayKey();
    let leveledUp = false;
    while (st.xp >= xpNeeded(st.level)) {
      st.xp -= xpNeeded(st.level);
      st.level += 1;
      leveledUp = true;
    }
    log.unshift({ date: todayKey(), stat: statKey, exp: amount, name: questName });
    log = log.slice(0, 80);
    await save('character', character);
    await save('log', log);
    if (leveledUp) showToast(statKey + ' 레벨 업! → Lv.' + st.level);
    else showToast('+' + amount + ' EXP · ' + statKey);
    if (leveledUp) await checkTierRewards(statKey);
  }

  function rolloverWeekly() {
    const today = todayKey();
    const stale = weeklyQuests.filter(q => !q.done && q.dueDate < today);
    stale.forEach(q => log.unshift({ date: today, stat: q.stat, exp: 0, name: q.name + ' (미완료·기한 마감)' }));
    weeklyQuests = weeklyQuests.filter(q => q.done || q.dueDate >= today);
    if (stale.length) save('log', log);
    save('weeklyQuests', weeklyQuests);
  }

  async function completeRoutineItem(kind, stat, id) {
    ensureDailyStatus();
    if (dailyStatus.done.includes(id)) return;
    const list = kind === 'overdrive' ? overdrive[stat] : routine[stat];
    const item = list.find(x => x.id === id);
    if (!item) return;
    dailyStatus.done.push(id);
    save('dailyStatus', dailyStatus);
    const factor = tierNerfFactor(stat);
    const awarded = Math.max(1, Math.round(item.exp * factor));
    const nerfTag = factor < 1 ? ' (너프 적용)' : '';
    await addXp(stat, awarded, item.name + (kind === 'overdrive' ? ' (오버드라이브)' : '') + nerfTag);
    render();
  }
  function addRoutineItem(stat, name, exp) {
    if (!name.trim()) return;
    routine[stat].push({ id: 'r' + Date.now() + Math.random(), name: name.trim(), exp: exp || 10 });
    save('routine', routine);
    render();
  }
  function removeRoutineItem(stat, id) {
    routine[stat] = routine[stat].filter(x => x.id !== id);
    save('routine', routine);
    render();
  }
  function addOverdriveItem(stat, name, exp) {
    if (!name.trim()) return;
    overdrive[stat].push({ id: 'o' + Date.now() + Math.random(), name: name.trim(), exp: exp || 20 });
    save('overdrive', overdrive);
    render();
  }
  function removeOverdriveItem(stat, id) {
    overdrive[stat] = overdrive[stat].filter(x => x.id !== id);
    save('overdrive', overdrive);
    render();
  }

  function addWeeklyQuest(stat, name, exp, days) {
    if (!name.trim()) return;
    const d = Math.max(1, Math.min(3, parseInt(days, 10) || 3));
    weeklyQuests.push({ id: 'w' + Date.now(), stat, name: name.trim(), exp: exp || 40, dueDate: addDays(todayKey(), d), done: false });
    save('weeklyQuests', weeklyQuests);
    render();
  }
  async function completeWeeklyQuest(id) {
    const q = weeklyQuests.find(x => x.id === id);
    if (!q || q.done) return;
    q.done = true;
    save('weeklyQuests', weeklyQuests);
    await addXp(q.stat, q.exp, q.name + ' (주간퀘스트)');
    render();
  }
  function removeWeeklyQuest(id) {
    weeklyQuests = weeklyQuests.filter(x => x.id !== id);
    save('weeklyQuests', weeklyQuests);
    render();
  }

  function addPoolItem(stat, name, exp) {
    if (!name.trim()) return;
    questPool[stat].push({ id: 'p' + Date.now(), name: name.trim(), exp: exp || 15 });
    save('questPool', questPool);
    render();
  }
  function removePoolItem(stat, id) {
    questPool[stat] = questPool[stat].filter(x => x.id !== id);
    save('questPool', questPool);
    render();
  }
  function promoteFromPool(stat, poolId, kind) {
    const item = questPool[stat].find(x => x.id === poolId);
    if (!item) return;
    if (kind === 'overdrive') addOverdriveItem(stat, item.name, item.exp);
    else addRoutineItem(stat, item.name, item.exp);
  }

  async function completeSubQuest(id) {
    const q = subQuests.find(x => x.id === id);
    if (!q || q.done) return;
    q.done = true;
    save('subQuests', subQuests);
    await addXp(q.stat, q.exp, q.name + ' (서브퀘스트)');
    render();
  }
  function removeSubQuest(id) {
    subQuests = subQuests.filter(x => x.id !== id);
    save('subQuests', subQuests);
    render();
  }
  function getPromotionCandidates() {
    const doneByKey = {};
    subQuests.filter(q => q.done).forEach(q => {
      const key = q.stat + '|' + q.name;
      if (!doneByKey[key]) doneByKey[key] = { stat: q.stat, name: q.name, exp: q.exp, count: 0 };
      doneByKey[key].count++;
    });
    return Object.keys(doneByKey).map(k => doneByKey[k]).filter(c => {
      if (c.count < PROMOTE_THRESHOLD) return false;
      if (promotionDismissed.includes(c.stat + '|' + c.name)) return false;
      if (routine[c.stat].some(r => r.name === c.name)) return false;
      return true;
    });
  }
  function acceptPromotion(stat, name, exp) {
    addRoutineItem(stat, name, exp);
    showToast(name + ' → 루틴으로 승격');
    render();
  }
  function dismissPromotion(stat, name) {
    promotionDismissed.push(stat + '|' + name);
    save('promotionDismissed', promotionDismissed);
    render();
  }

  function getTierMismatchCandidates() {
    return STATS.filter(s => {
      const t = tierFor(character.stats[s.key].level);
      return t !== (tierAck[s.key] || 1) && tierNoticeDismissed[s.key] !== t;
    }).map(s => {
      const t = tierFor(character.stats[s.key].level);
      return { stat: s.key, name: s.name, tier: t, ackTier: tierAck[s.key] || 1, level: character.stats[s.key].level, direction: t > (tierAck[s.key] || 1) ? 'up' : 'down' };
    });
  }

  async function recalibrateRoutine(stat) {
    const tier = tierFor(character.stats[stat].level);
    const prevTier = tierAck[stat] || 1;
    const direction = tier > prevTier ? 'up' : 'down';
    tierRegenState[stat] = 'loading';
    render();
    try {
      const statName = STATS.find(s => s.key === stat).name;
      const idx = freqIndexFor(stat);
      const rExp = Math.round(ROUTINE_EXP_BAND[idx] * (1 + (tier - 1) * 0.35));
      const oExp = Math.round(OVERDRIVE_EXP_BAND[idx] * (1 + (tier - 1) * 0.35));
      const prevNames = routine[stat].map(x => x.name).concat(overdrive[stat].map(x => x.name));
      const dirText = direction === 'up'
        ? '이전보다 확실히 더 본격적이고 밀도 있는, 결과물 지향적인 활동으로 발전시킨다(예: CRE는 감상→아웃풋 제작, INT는 단어암기→심화 리서치, GLD는 소비기록→투자 관리, WIS는 일기→글쓰기/깊은 성찰, CHA는 이메일 연습→실제 네트워킹 액션).'
        : '사용자가 이전 난이도를 힘들어해서 완화 요청함. 이전보다 확실히 더 가볍고 부담 없는, 입문 수준으로 되돌린다.';
      const sys = '너는 "인생 RPG 시스템"의 루틴 난이도 조정기다. ' +
        stat + '(' + statName + ') 스탯을 티어 ' + tier + '(5단계 중, 숫자가 높을수록 상급)에 맞춰 재조정한다. ' +
        '이전 루틴: ' + prevNames.join(', ') + '. ' + dirText + ' ' +
        '30분 이내로 끝나는 새 루틴 2개와 오버드라이브 1개를 제안한다. EXP 숫자는 신경쓰지 않아도 된다. ' +
        '반드시 JSON만 출력. 형식: {"routine":[{"name":"..."},{"name":"..."}],"overdrive":[{"name":"..."}]}';
      let raw = await callAI(sys, '새 루틴을 제안해줘.', 600, '{}');
      const cfg = JSON.parse(raw);
      routine[stat] = (cfg.routine || []).slice(0, 4).map((it, i) => ({
        id: 'r' + Date.now() + i, name: String(it.name).slice(0, 60), exp: rExp + (i === 1 ? 4 : 0)
      }));
      overdrive[stat] = (cfg.overdrive || []).slice(0, 2).map((it, i) => ({
        id: 'o' + Date.now() + i, name: String(it.name).slice(0, 60), exp: oExp
      }));
      tierAck[stat] = tier;
      tierNoticeDismissed[stat] = tier;
      await save('routine', routine);
      await save('overdrive', overdrive);
      await save('tierAck', tierAck);
      await save('tierNoticeDismissed', tierNoticeDismissed);
      delete tierRegenState[stat];
      showToast(statName + ' 루틴이 티어 ' + tier + '로 재조정됨');
    } catch (e) {
      console.error('tier regen failed', e);
      tierRegenState[stat] = classifyAiError(e);
      if (e.message !== 'NO_API_KEY') lastErrorDetail = String(e.message || e);
    }
    render();
  }
  function dismissTierNotice(stat) {
    tierNoticeDismissed[stat] = tierFor(character.stats[stat].level);
    save('tierNoticeDismissed', tierNoticeDismissed);
    render();
  }

  let toastTimer = null;
  function showToast(msg) {
    let el = root.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; root.appendChild(el); }
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function crestSvg() {
    const cx = 80, cy = 80, R = 60;
    const maxLevel = Math.max(5, ...STATS.map(s => character.stats[s.key].level + 1));
    const angleFor = i => (Math.PI * 2 * i / 6) - Math.PI / 2;
    const pt = (i, r) => [cx + r * Math.cos(angleFor(i)), cy + r * Math.sin(angleFor(i))];

    const rings = [0.33, 0.66, 1].map(f => {
      const pts = STATS.map((_, i) => pt(i, R * f).join(',')).join(' ');
      return '<polygon points="' + pts + '" fill="none" stroke="#E5E8EB" stroke-width="1"/>';
    }).join('');

    const axes = STATS.map((_, i) => {
      const [x,y] = pt(i, R);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" stroke="#E5E8EB" stroke-width="1"/>';
    }).join('');

    const dataPts = STATS.map((s, i) => {
      const lv = character.stats[s.key].level;
      const r = R * (lv / maxLevel);
      return pt(i, r);
    });
    const dataPoly = '<polygon points="' + dataPts.map(p => p.join(',')).join(' ') + '" fill="#3182F6" fill-opacity="0.14" stroke="#3182F6" stroke-width="2"/>';
    const dots = dataPts.map((p, i) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="' + STATS[i].color + '"/>').join('');
    const labels = STATS.map((s, i) => {
      const [x,y] = pt(i, R + 15);
      return '<text x="' + x + '" y="' + y + '" text-anchor="middle" dominant-baseline="middle" font-family="Roboto Mono, monospace" font-size="10" font-weight="700" fill="' + s.color + '">' + s.key + '</text>';
    }).join('');

    return '<svg class="crest-svg" width="160" height="160" viewBox="0 0 160 160">' + rings + axes + dataPoly + dots + labels + '</svg>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---- AI: memo -> subquest ----
  async function parseWithAI() {
    const input = root.querySelector('#ai-input');
    const text = input ? input.value.trim() : '';
    if (!text) return;
    lastMemoText = text;
    aiState = 'loading';
    aiSuggestions = [];
    render();
    try {
      const statList = STATS.map(s => s.key + '(' + s.name + ')').join(', ');
      const sys = '너는 "인생 RPG 시스템"이라는 개인용 게이미피케이션 라이프 트래커의 분류기다. ' +
        '사용자가 붙여넣은 자유 텍스트(할 일 메모, 일정, 목표 등)를 읽고, 이 6개 스탯 중 하나로 분류해서 "서브퀘스트" 후보를 만든다: ' + statList + '. ' +
        '서브퀘스트는 매일 고정 반복되는 루틴이 아니라, 특정 목표를 향한 1회성 또는 파생 작업이다. ' +
        'EXP는 난이도에 비례해 10~90 사이에서 정한다. ' +
        '반드시 JSON 배열만 출력한다. 다른 설명, 마크다운, 코드블록 표시 없이 순수 JSON만. ' +
        '형식: [{"stat":"STR","name":"...","exp":20}, ...]';
      let raw = await callAI(sys, text, 1000, '[]');
      const parsed = JSON.parse(raw);
      aiSuggestions = parsed.filter(p => STATS.some(s => s.key === p.stat)).map((p, i) => ({
        id: 'ai' + Date.now() + i, stat: p.stat,
        name: String(p.name).slice(0, 80), exp: Math.max(1, parseInt(p.exp, 10) || 10), checked: true
      }));
      aiState = 'idle';
    } catch (e) {
      console.error('AI parse failed', e);
      aiState = classifyAiError(e);
      if (e.message !== 'NO_API_KEY') lastErrorDetail = String(e.message || e);
    }
    render();
  }
  function toggleAISuggestion(id) {
    const s = aiSuggestions.find(x => x.id === id);
    if (s) s.checked = !s.checked;
    render();
  }
  function addAISuggestions() {
    const chosen = aiSuggestions.filter(s => s.checked);
    chosen.forEach(s => {
      subQuests.push({ id: 'sq' + Date.now() + Math.random(), stat: s.stat, name: s.name, exp: s.exp, done: false, created: todayKey() });
    });
    save('subQuests', subQuests);
    aiSuggestions = [];
    const input = root.querySelector('#ai-input');
    if (input) input.value = '';
    showToast(chosen.length + '개 서브퀘스트로 등록됨');
    render();
  }

  // ---- Onboarding wizard ----
  function wizardChoice(key, value) {
    wizardAnswers[key] = value;
    wizardStep++;
    if (wizardStep >= WIZARD_STEPS.length) generateFromAnswers();
    else render();
  }
  function wizardMultiToggle(key, value) {
    if (!Array.isArray(wizardAnswers[key])) wizardAnswers[key] = [];
    const arr = wizardAnswers[key];
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1); else arr.push(value);
    render();
  }
  function wizardMultiNext() {
    wizardStep++;
    if (wizardStep >= WIZARD_STEPS.length) generateFromAnswers();
    else render();
  }
  function wizardTextNext() {
    const step = WIZARD_STEPS[wizardStep];
    const input = root.querySelector('#wizard-text-input');
    const val = input ? input.value.trim() : '';
    if (!val && !step.optional) return;
    wizardAnswers[step.key] = val;
    wizardStep++;
    if (wizardStep >= WIZARD_STEPS.length) generateFromAnswers();
    else render();
  }
  function wizardBack() {
    if (wizardStep === 0) return;
    wizardStep--;
    render();
  }
  function wizardRestart() {
    wizardOpen = true;
    wizardStep = 0;
    wizardAnswers = {};
    render();
  }
  function wizardCollapse() {
    wizardOpen = false;
    render();
  }

  const FREQ_STAT_MAP = { STR: 'exercise', INT: 'learning', CRE: 'creative', CHA: 'social', WIS: 'mental', GLD: 'finance' };
  const ROUTINE_EXP_BAND = [8, 14, 20, 28];
  const OVERDRIVE_EXP_BAND = [15, 22, 30, 40];

  function freqIndexFor(statKey) {
    const qKey = FREQ_STAT_MAP[statKey];
    const step = WIZARD_STEPS.find(s => s.key === qKey);
    if (!step) return 0;
    const idx = step.options.indexOf(wizardAnswers[qKey]);
    return idx >= 0 ? idx : 0;
  }

  function compileAnswersText(a) {
    const parts = [];
    if (a.job) parts.push('직업/전공/상황: ' + a.job);
    if (a.exercise) parts.push('운동 습관: ' + a.exercise);
    if (a.learning) parts.push('학습 습관: ' + a.learning);
    if (a.creative) parts.push('창작 활동 빈도: ' + a.creative);
    if (a.social) parts.push('커리어 네트워킹 빈도: ' + a.social);
    if (a.mental) parts.push('스트레스·휴식 관리: ' + a.mental);
    if (a.finance) parts.push('재정 관리 습관: ' + a.finance);
    if (a.weakStat && a.weakStat.length) parts.push('신경 쓰고 싶은 영역: ' + a.weakStat.join(', '));
    if (a.goal) parts.push('요즘 목표: ' + a.goal);
    return parts.join('. ');
  }

  async function generateFromAnswers() {
    const text = compileAnswersText(wizardAnswers);
    await generateFromText(text);
  }

  async function generateFromText(text) {
    if (!text) return;
    onboardState = 'loading';
    render();
    try {
      const sys = '너는 "인생 RPG 시스템"이라는 개인용 게이미피케이션 라이프 트래커의 온보딩 캘리브레이터다. ' +
        '사용자의 설문 답변을 바탕으로 캐릭터 초기 루틴을 생성한다. ' +
        '6개 스탯: STR(활력), INT(지력), CRE(창의), CHA(소셜/커리어 네트워킹), WIS(멘탈), GLD(자원). ' +
        '스탯 레벨은 신경쓰지 않아도 된다(항상 0에서 시작한다). ' +
        '모든 루틴은 지금 막 시작하는 사람 기준의 가장 가벼운 난이도(입문 티어)로 만든다. ' +
        '스탯별 방향: ' +
        'STR은 물 마시기/스트레칭/짧은 산책처럼 부담 없는 신체 습관. ' +
        'INT는 어휘 암기, 언어 섀도잉, 짧은 리딩처럼 가벼운 지식 습관 위주로 하되, 직업/전공이 언급되면 그 분야 입문 학습(예: 디자인이면 업계 아티클, 이공계면 짧은 논문 요약 읽기 등)을 섞는다. ' +
        'CRE는 결과물 제작보다 영감 수집(작품 감상, 레퍼런스 저장, 인사이트 메모)처럼 가벼운 관찰 위주로 하되, 직업/전공에 맞는 분야의 레퍼런스로 조정한다. ' +
        'CHA는 개인적 인간관계가 아니라 커리어 관련 소셜 자본 쌓기 — 이메일 작성 연습, 커리어 진행상황 공유, 업계 사람과의 짧은 연결처럼 가벼운 것부터. ' +
        'WIS는 감정 일기, 짧은 명상처럼 가장 기본적인 자기돌봄. ' +
        'GLD는 정식 가계부보다 내일 소비 예측하기, 오늘 소비 피드백, 영수증 챙기기처럼 가벼운 시작. ' +
        '"신경 쓰고 싶은 영역"으로 언급된 스탯은 루틴을 더 알차고 구체적으로 짜준다(레벨을 올리지는 않음). ' +
        '스탯마다 30분 이내로 끝나는 고정 루틴 2개와, 조금 더 힘든 오버드라이브 1개를 제안한다. EXP 숫자는 신경쓰지 않아도 된다. ' +
        '목표가 언급되면, 그 목표를 향한 1회성 서브퀘스트를 3~6개 제안한다(3일 이내에 끝낼 수 있는 크기로 잘게 쪼갠다). 목표가 없으면 빈 배열. ' +
        '반드시 JSON 객체만 출력, 다른 설명이나 마크다운 없이. 형식: ' +
        '{"routine":{"STR":[{"name":"..."},{"name":"..."}],"INT":[...],"CRE":[...],"CHA":[...],"WIS":[...],"GLD":[...]},' +
        '"overdrive":{"STR":[{"name":"..."}],"INT":[...],"CRE":[...],"CHA":[...],"WIS":[...],"GLD":[...]},' +
        '"subquests":[{"stat":"STR","name":"...","exp":N}]}';
      let raw = await callAI(sys, text, 2000, '{}');
      const cfg = JSON.parse(raw);

      STATS.forEach(s => {
        character.stats[s.key] = { level: 0, xp: 0, lastActive: null };
        const idx = freqIndexFor(s.key);
        const rExp = ROUTINE_EXP_BAND[idx];
        const oExp = OVERDRIVE_EXP_BAND[idx];
        routine[s.key] = ((cfg.routine && cfg.routine[s.key]) || []).slice(0, 4).map((it, i) => ({
          id: 'r' + Date.now() + s.key + i, name: String(it.name).slice(0, 60), exp: rExp + (i === 1 ? 4 : 0)
        }));
        overdrive[s.key] = ((cfg.overdrive && cfg.overdrive[s.key]) || []).slice(0, 2).map((it, i) => ({
          id: 'o' + Date.now() + s.key + i, name: String(it.name).slice(0, 60), exp: oExp
        }));
        tierAck[s.key] = 1;
        tierNoticeDismissed[s.key] = 0;
        tierRewardGiven[s.key] = 1;
        skipTokens[s.key] = 0;
      });
      (cfg.subquests || []).forEach((w, i) => {
        if (!STATS.some(s => s.key === w.stat)) return;
        subQuests.push({ id: 'sq' + Date.now() + i, stat: w.stat, name: String(w.name).slice(0, 70), exp: Math.max(1, parseInt(w.exp, 10) || 20), done: false, created: todayKey() });
      });

      await save('character', character);
      await save('routine', routine);
      await save('overdrive', overdrive);
      await save('tierAck', tierAck);
      await save('tierNoticeDismissed', tierNoticeDismissed);
      await save('tierRewardGiven', tierRewardGiven);
      await save('skipTokens', skipTokens);
      await save('subQuests', subQuests);
      await save('weeklyQuests', weeklyQuests);
      dailyStatus = { date: todayKey(), done: [] };
      await save('dailyStatus', dailyStatus);

      onboardState = 'idle';
      wizardOpen = false;
      wizardStep = 0;
      wizardAnswers = {};
      showToast('캐릭터 초기 설정 완료');
    } catch (e) {
      console.error('onboarding failed', e);
      onboardState = classifyAiError(e);
      if (e.message !== 'NO_API_KEY') lastErrorDetail = String(e.message || e);
    }
    render();
  }

  function applyNewKeyAndRetry(trimmed) {
    setApiKey(trimmed);
    showToast(trimmed ? 'API 키가 저장됐어요 · 이어서 진행할게요' : 'API 키가 삭제됐어요');
    if (!trimmed) { render(); return; }

    // 키가 막 등록/교체됐다면, 방금 막혔던 작업이 있는지 확인해서 자동으로 재시도한다.
    if (onboardState === 'nokey' || onboardState === 'keyerror') {
      onboardState = 'idle';
      generateFromAnswers();
      return;
    }
    if (aiState === 'nokey' || aiState === 'keyerror') {
      aiState = 'idle';
      const input = root.querySelector('#ai-input');
      if (input && lastMemoText) input.value = lastMemoText;
      if (lastMemoText) { parseWithAI(); return; }
    }
    const stuckStat = STATS.find(s => tierRegenState[s.key] === 'nokey' || tierRegenState[s.key] === 'keyerror');
    if (stuckStat) {
      delete tierRegenState[stuckStat.key];
      recalibrateRoutine(stuckStat.key);
      return;
    }
    render();
  }

  function apiKeyGuideHtml() {
    return '<div class="ai-hint" style="margin-top:2px;">' +
        '1. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--primary);font-weight:700;">Google AI Studio</a>에서 무료로 키 발급 (Get API key 클릭)<br/>' +
        '2. 발급받은 키를 복사해서 아래에 붙여넣기' +
      '</div>' +
      '<div class="add-row" style="margin-top:8px;">' +
        '<input class="nm-input" id="inline-api-key-input" placeholder="AIza... 또는 AQ..." style="flex:1;"/>' +
        '<button onclick="window.__lifeRpg.saveInlineKey()">저장하고 계속하기</button>' +
      '</div>';
  }

  function renderWizard() {
    if (!wizardOpen) {
      return '<div class="card"><div class="wizard-collapsed">' +
        '<span class="wizard-collapsed-text">🪄 캐릭터를 다시 설정하고 싶으신가요?</span>' +
        '<button class="btn-small" onclick="window.__lifeRpg.wizardRestart()">다시 설정</button>' +
        '</div></div>';
    }
    if (onboardState === 'loading') {
      return '<div class="wizard-card"><div class="wizard-intro-eyebrow">AI 온보딩</div>' +
        '<div class="wizard-intro-title">답변을 바탕으로<br/>캐릭터를 만드는 중이에요</div>' +
        '<div class="ai-loading">잠시만 기다려주세요…</div></div>';
    }
    if (onboardState === 'keyerror') {
      return '<div class="wizard-card"><div class="wizard-intro-eyebrow">AI 온보딩</div>' +
        '<div class="wizard-intro-title">API 키를 확인해주세요</div>' +
        '<div class="ai-hint">키가 잘못됐거나 권한이 없는 것 같아요. 새 키로 바꿔보세요.</div>' +
        apiKeyGuideHtml() +
        '</div>';
    }
    if (onboardState === 'error') {
      return '<div class="wizard-card"><div class="wizard-intro-eyebrow">AI 온보딩</div>' +
        '<div class="wizard-intro-title">생성에 실패했어요</div>' +
        '<button class="btn-primary" onclick="window.__lifeRpg.retryGenerate()">다시 시도</button></div>';
    }
    if (onboardState === 'nokey') {
      return '<div class="wizard-card"><div class="wizard-intro-eyebrow">AI 온보딩</div>' +
        '<div class="wizard-intro-title">API 키가 필요해요</div>' +
        apiKeyGuideHtml() +
        '</div>';
    }
    if (wizardStep >= WIZARD_STEPS.length) return '';

    const step = WIZARD_STEPS[wizardStep];
    const total = WIZARD_STEPS.length;
    const dots = WIZARD_STEPS.map((_, i) =>
      '<div class="dot ' + (i <= wizardStep ? 'filled' : '') + '"></div>'
    ).join('');

    const backBtn = wizardStep > 0 ? '<button class="wizard-back" onclick="window.__lifeRpg.wizardBack()">← 이전</button>' : '';

    let body = '';
    if (step.type === 'choice') {
      body = '<div class="wizard-options">' + step.options.map(opt =>
        '<button class="wizard-opt" onclick="window.__lifeRpg.wizardChoice(\'' + step.key + '\',\'' + opt.replace(/'/g,"&#39;") + '\')">' + escapeHtml(opt) + '</button>'
      ).join('') + '</div>';
    } else if (step.type === 'multi') {
      const selected = Array.isArray(wizardAnswers[step.key]) ? wizardAnswers[step.key] : [];
      body = '<div class="wizard-options">' + step.options.map(opt => {
        const isSel = selected.includes(opt);
        return '<button class="wizard-opt" style="' + (isSel ? 'border-color:var(--primary);background:var(--primary-soft);' : '') + '" onclick="window.__lifeRpg.wizardMultiToggle(\'' + step.key + '\',\'' + opt.replace(/'/g,"&#39;") + '\')">' +
          (isSel ? '✓ ' : '') + escapeHtml(opt) + '</button>';
      }).join('') + '</div>' +
      '<button class="btn-primary" onclick="window.__lifeRpg.wizardMultiNext()">다음</button>';
    } else {
      body = '<input class="field-input" id="wizard-text-input" style="width:100%;margin-bottom:16px;" placeholder="' + escapeHtml(step.ph || '') + '"/>' +
        '<div class="wizard-nav">' +
        '<button class="btn-primary" onclick="window.__lifeRpg.wizardTextNext()">다음</button>' +
        '</div>';
    }
    const skipLink = step.optional ? '<button class="wizard-skip" onclick="window.__lifeRpg.wizardChoice(\'' + step.key + '\',\'\')">건너뛰기</button>' : '';

    return '<div class="wizard-card">' +
      backBtn +
      '<div class="wizard-progress">' + dots + '</div>' +
      '<div class="wizard-step-count">' + (wizardStep + 1) + ' / ' + total + '</div>' +
      '<div class="wizard-q">' + escapeHtml(step.q) + '</div>' +
      (step.sub ? '<div class="wizard-sub">' + escapeHtml(step.sub) + '</div>' : '') +
      body +
      skipLink +
      '</div>';
  }

  function render() {
    const level = STATS.reduce((sum, s) => sum + character.stats[s.key].level, 0);
    const avgLevel = (level / STATS.length).toFixed(1);

    const statRows = STATS.map(s => {
      const st = character.stats[s.key];
      const need = xpNeeded(st.level);
      const pct = Math.min(100, Math.round((st.xp / need) * 100));
      const d = daysSince(st.lastActive);
      const neglect = (st.lastActive && d >= DECAY_THRESHOLD) ? '<span class="neglect-badge">' + d + '일째</span>' : '';
      const tokens = skipTokens[s.key] > 0 ? '<span class="neglect-badge" style="color:var(--primary);background:var(--primary-soft);">🛡️' + skipTokens[s.key] + '</span>' : '';
      return '<div class="stat-row">' +
        '<span class="stat-tag" style="color:' + s.color + '">' + s.key + '</span>' +
        '<div class="stat-bar-bg"><div class="stat-bar-fill" style="width:' + pct + '%;background:' + s.color + '"></div></div>' +
        '<span class="stat-lv">Lv.' + st.level + '</span>' + neglect + tokens +
        '</div>';
    }).join('');

    let anyRoutine = false;
    const routineBlocks = STATS.map(s => {
      const items = routine[s.key];
      const odItems = overdrive[s.key];
      if (!items.length && !odItems.length) return '';
      anyRoutine = true;
      const rRows = items.map(it => {
        const done = dailyStatus.done.includes(it.id);
        return '<div class="quest-card ' + (done ? 'done' : '') + '">' +
          '<div class="quest-check" onclick="window.__lifeRpg.completeRoutine(\'routine\',\'' + s.key + '\',\'' + it.id + '\')">' + (done ? '✓' : '') + '</div>' +
          '<div class="quest-stat-dot" style="background:' + s.color + '"></div>' +
          '<div class="quest-name">' + escapeHtml(it.name) + '</div>' +
          '<div class="quest-exp">+' + it.exp + '</div>' +
          '</div>';
      }).join('');
      const odRows = odItems.map(it => {
        const done = dailyStatus.done.includes(it.id);
        return '<div class="quest-card overdrive ' + (done ? 'done' : '') + '">' +
          '<div class="quest-check" onclick="window.__lifeRpg.completeRoutine(\'overdrive\',\'' + s.key + '\',\'' + it.id + '\')">' + (done ? '✓' : '') + '</div>' +
          '<span class="od-tag">OD</span>' +
          '<div class="quest-name">' + escapeHtml(it.name) + '</div>' +
          '<div class="quest-exp">+' + it.exp + '</div>' +
          '</div>';
      }).join('');
      return '<div class="stat-group-label" style="color:' + s.color + '">● ' + s.key + ' · ' + s.name + '</div>' + rRows + odRows;
    }).join('');
    const dailyItems = anyRoutine ? routineBlocks : '<div class="empty-note">아직 고정 루틴이 없어요. 위 온보딩을 완료하거나 아래 퀘스트 풀에서 추가해보세요.</div>';

    const thisWeek = weeklyQuests;
    const weeklyItems = thisWeek.length ? thisWeek.map(q => {
      const sInfo = STATS.find(s => s.key === q.stat);
      const dleft = daysUntil(q.dueDate);
      const ddayTag = q.done ? '' : ('<span class="quest-exp" style="color:' + (dleft <= 0 ? 'var(--danger)' : 'var(--muted)') + ';font-weight:700;">D' + (dleft <= 0 ? '-day' : ('-' + dleft)) + '</span>');
      return '<div class="quest-card ' + (q.done ? 'done' : '') + '">' +
        '<div class="quest-check" onclick="window.__lifeRpg.completeWeekly(\'' + q.id + '\')">' + (q.done ? '✓' : '') + '</div>' +
        '<div class="quest-stat-dot" style="background:' + sInfo.color + '"></div>' +
        '<div class="quest-name">' + escapeHtml(q.name) + '</div>' +
        ddayTag +
        '<div class="quest-exp">+' + q.exp + ' ' + q.stat + '</div>' +
        (q.done ? '' : '<button class="quest-remove" onclick="window.__lifeRpg.removeWeekly(\'' + q.id + '\')">✕</button>') +
        '</div>';
    }).join('') : '<div class="empty-note">진행 중인 주간 퀘스트가 없어요.</div>';

    const statOptions = STATS.map(s => '<option value="' + s.key + '">' + s.key + ' · ' + s.name + '</option>').join('');

    const poolBlocks = STATS.map(s => {
      const items = questPool[s.key];
      const rows = items.length ? items.map(it =>
        '<div class="pool-item"><span class="nm">' + escapeHtml(it.name) + '</span><span class="ex">+' + it.exp + '</span>' +
        '<button class="mini-btn" onclick="window.__lifeRpg.promotePool(\'' + s.key + '\',\'' + it.id + '\',\'routine\')">→루틴</button>' +
        '<button class="mini-btn" onclick="window.__lifeRpg.promotePool(\'' + s.key + '\',\'' + it.id + '\',\'overdrive\')">→OD</button>' +
        '<button class="quest-remove" onclick="window.__lifeRpg.removePool(\'' + s.key + '\',\'' + it.id + '\')">✕</button></div>'
      ).join('') : '<div class="empty-note" style="padding:4px 0;">아직 항목 없음</div>';
      return '<div class="pool-stat-block">' +
        '<div class="pool-stat-title" style="color:' + s.color + '">● ' + s.key + ' · ' + s.name + '</div>' +
        rows +
        '<div class="add-row">' +
        '<input class="nm-input" placeholder="항목 이름" data-stat="' + s.key + '" data-role="nm"/>' +
        '<input class="exp-input" type="number" placeholder="EXP" value="15" data-stat="' + s.key + '" data-role="exp"/>' +
        '<button onclick="window.__lifeRpg.addPool(\'' + s.key + '\')">추가</button>' +
        '</div></div>';
    }).join('');

    const logItems = log.slice(0, 12).map(l =>
      '<div class="log-item"><span>' + l.date + ' · ' + escapeHtml(l.name) + '</span><span class="gain">' + (l.exp > 0 ? '+' + l.exp + ' ' + l.stat : '') + '</span></div>'
    ).join('') || '<div class="empty-note">아직 기록 없음</div>';

    const aiSuggestBlock = aiSuggestions.length ? aiSuggestions.map(s => {
      const sInfo = STATS.find(x => x.key === s.stat);
      return '<div class="ai-suggest-card">' +
        '<input type="checkbox" ' + (s.checked ? 'checked' : '') + ' onchange="window.__lifeRpg.aiToggle(\'' + s.id + '\')"/>' +
        '<div class="ai-suggest-meta"><div class="ai-suggest-name">' + escapeHtml(s.name) + '</div>' +
        '<div class="ai-suggest-tags"><span style="color:' + sInfo.color + '">' + s.stat + '</span> · <span class="exp">+' + s.exp + '</span></div></div>' +
        '</div>';
    }).join('') + '<button class="btn-primary" onclick="window.__lifeRpg.aiAdd()">선택한 항목 서브퀘스트로 추가</button>' : '';

    const aiStatusBlock = aiState === 'loading' ? '<div class="ai-loading">AI가 분류하는 중…</div>' :
      aiState === 'nokey' ? ('<div class="ai-error">API 키가 필요해요</div>' + apiKeyGuideHtml()) :
      aiState === 'keyerror' ? ('<div class="ai-error">API 키를 확인해주세요 — 잘못됐거나 권한이 없는 것 같아요.</div>' + apiKeyGuideHtml()) :
      aiState === 'error' ? '<div class="ai-error">분류에 실패했어요. 다시 시도해주세요.</div>' : '';

    const promoCandidates = getPromotionCandidates();
    const promoBlock = promoCandidates.length ? promoCandidates.map(c => {
      return '<div class="promo-banner">' +
        '<div class="promo-title">🔁 <b>' + escapeHtml(c.name) + '</b> 서브퀘스트를 ' + c.count + '번 완료했어요. 루틴으로 추가할까요?</div>' +
        '<div class="promo-actions">' +
        '<button class="promo-accept" onclick="window.__lifeRpg.acceptPromo(\'' + c.stat + '\',\'' + c.name.replace(/'/g,"&#39;") + '\',' + c.exp + ')">루틴에 추가</button>' +
        '<button class="promo-dismiss" onclick="window.__lifeRpg.dismissPromo(\'' + c.stat + '\',\'' + c.name.replace(/'/g,"&#39;") + '\')">무시</button>' +
        '</div></div>';
    }).join('') : '';

    const tierCandidates = getTierMismatchCandidates();
    const tierBlock = tierCandidates.map(c => {
      if (tierRegenState[c.stat] === 'loading') {
        return '<div class="promo-banner"><div class="promo-title">✨ ' + c.name + ' 루틴을 티어 ' + c.tier + '로 재조정하는 중…</div></div>';
      }
      if (tierRegenState[c.stat] === 'nokey') {
        return '<div class="promo-banner"><div class="promo-title">🔑 API 키가 필요해요</div>' + apiKeyGuideHtml() + '</div>';
      }
      if (tierRegenState[c.stat] === 'keyerror') {
        return '<div class="promo-banner"><div class="promo-title">🔑 API 키를 확인해주세요 — 잘못됐거나 권한이 없는 것 같아요.</div>' + apiKeyGuideHtml() + '</div>';
      }
      if (c.direction === 'up') {
        return '<div class="promo-banner">' +
          '<div class="promo-title">🎯 <b>' + c.name + '</b>이(가) Lv.' + c.level + '(티어 ' + c.tier + ')에 도달했어요. 루틴 난이도를 올릴까요? 유지하면 이 스탯 획득 EXP가 조금 줄어들어요.</div>' +
          '<div class="promo-actions">' +
          '<button class="promo-accept" onclick="window.__lifeRpg.recalibrate(\'' + c.stat + '\')">난이도 올리기</button>' +
          '<button class="promo-dismiss" onclick="window.__lifeRpg.dismissTier(\'' + c.stat + '\')">지금은 유지</button>' +
          '</div></div>';
      }
      return '<div class="promo-banner">' +
        '<div class="promo-title">😮‍💨 <b>' + c.name + '</b> 루틴이 지금 레벨엔 버거울 수 있어요. 난이도를 낮출까요?</div>' +
        '<div class="promo-actions">' +
        '<button class="promo-accept" onclick="window.__lifeRpg.recalibrate(\'' + c.stat + '\')">난이도 낮추기</button>' +
        '<button class="promo-dismiss" onclick="window.__lifeRpg.dismissTier(\'' + c.stat + '\')">이대로 유지</button>' +
        '</div></div>';
    }).join('');

    const openSubQuests = subQuests.filter(q => !q.done);
    const subQuestItems = openSubQuests.length ? openSubQuests.map(q => {
      const sInfo = STATS.find(s => s.key === q.stat);
      return '<div class="quest-card">' +
        '<div class="quest-check" onclick="window.__lifeRpg.completeSub(\'' + q.id + '\')"></div>' +
        '<div class="quest-stat-dot" style="background:' + sInfo.color + '"></div>' +
        '<div class="quest-name">' + escapeHtml(q.name) + '</div>' +
        '<div class="quest-exp">+' + q.exp + ' ' + q.stat + '</div>' +
        '<button class="quest-remove" onclick="window.__lifeRpg.removeSub(\'' + q.id + '\')">✕</button>' +
        '</div>';
    }).join('') : '<div class="empty-note">등록된 서브퀘스트가 없어요. 아래 메모 변환에서 만들어보세요.</div>';

    root.innerHTML =
      '<h1>인생 RPG 시스템</h1>' +
      '<div class="subtitle">캐릭터 시트 · 고정 루틴 · 서브퀘스트</div>' +
      renderWizard() +
      (wizardOpen ? '' :
        '<div class="card">' +
          '<div class="crest-wrap">' +
            crestSvg() +
            '<div class="stat-list">' + statRows + '</div>' +
          '</div>' +
          '<div style="text-align:center;margin-top:14px;border-top:1px solid var(--border);padding-top:14px;">' +
          '<div class="char-level"><div class="num">' + avgLevel + '</div><div class="lbl">종합 레벨</div></div>' +
          '</div>' +
        '</div>' +
        promoBlock +
        tierBlock +
        '<section class="card ai-box"><div class="section-head"><h2>✨ 메모 → 서브퀘스트</h2></div>' +
          '<div class="ai-hint">할 일이나 목표를 붙여넣으면 AI가 서브퀘스트로 만들어줘요. 같은 걸 ' + PROMOTE_THRESHOLD + '번 완료하면 루틴 승격을 제안해요.</div>' +
          '<textarea id="ai-input" placeholder="예: 포트폴리오 사이트 배포하기, 목요일 헬스장 등록"></textarea>' +
          '<button class="btn-primary" onclick="window.__lifeRpg.aiParse()">AI로 변환</button>' +
          aiStatusBlock + aiSuggestBlock +
        '</section>' +
        '<section><div class="section-head"><h2>🟢 서브퀘스트</h2><span class="meta">목표 파생</span></div><div class="card">' + subQuestItems + '</div></section>' +
        '<section><div class="section-head"><h2>🔵 오늘의 루틴</h2><span class="meta">고정</span></div><div class="card">' + dailyItems + '</div></section>' +
        '<section><div class="section-head"><h2>🟣 주간 퀘스트</h2><span class="meta">최대 3일 분량</span></div><div class="card">' +
          weeklyItems +
          (adminMode ?
            '<div class="weekly-add">' +
              '<select id="wk-stat">' + statOptions + '</select>' +
              '<input class="nm-input" id="wk-name" placeholder="3일 내 끝낼 일" style="flex:1;min-width:120px;"/>' +
              '<input class="exp-input" id="wk-exp" type="number" placeholder="EXP" value="40"/>' +
              '<select id="wk-days"><option value="1">D+1</option><option value="2">D+2</option><option value="3" selected>D+3</option></select>' +
              '<button onclick="window.__lifeRpg.addWeekly()" style="background:var(--primary);color:#fff;border:none;border-radius:12px;padding:0 14px;font-weight:700;cursor:pointer;">추가</button>' +
            '</div>' : ''
          ) +
        '</div></section>' +
        (adminMode ?
          '<section><details class="card" open>' +
            '<summary>⚙ 퀘스트 풀 관리 (관리자 모드)</summary>' +
            poolBlocks +
          '</details></section>' +
          '<div style="text-align:center;margin-bottom:12px;">' +
            '<button class="btn-small" onclick="window.__lifeRpg.openSettings()">🔑 API 키 관리 (' + (hasApiKey() ? '✓ 설정됨' : '설정 필요') + ')</button>' +
          '</div>' : ''
        ) +
        '<section><div class="section-head"><h2>🏅 업적</h2><span class="meta">' + badges.length + '개</span></div><div class="card">' +
          (badges.length ? badges.slice().reverse().slice(0, 20).map(b => {
            const sInfo = STATS.find(s => s.key === b.stat);
            return '<div class="log-item"><span><span class="quest-stat-dot" style="background:' + (sInfo ? sInfo.color : 'var(--muted)') + ';display:inline-block;margin-right:6px;"></span>' + escapeHtml(b.label) + '</span><span class="gain">' + b.date + '</span></div>';
          }).join('') : '<div class="empty-note">아직 획득한 업적이 없어요.</div>') +
        '</div></section>' +
        '<section><div class="section-head"><h2>기록</h2></div><div class="card">' + logItems + '</div></section>' +
        '<div style="text-align:center;margin-top:8px;">' +
          '<button class="wizard-skip" onclick="window.__lifeRpg.toggleAdmin()">' + (adminMode ? '관리자 모드 끄기' : '관리자 모드') + '</button>' +
        '</div>'
      );
  }

  window.__lifeRpg = {
    completeRoutine: completeRoutineItem,
    completeWeekly: completeWeeklyQuest,
    removeWeekly: removeWeeklyQuest,
    removePool: removePoolItem,
    promotePool: promoteFromPool,
    addPool: function(stat) {
      const nmEl = root.querySelector('input[data-stat="' + stat + '"][data-role="nm"]');
      const exEl = root.querySelector('input[data-stat="' + stat + '"][data-role="exp"]');
      addPoolItem(stat, nmEl.value, parseInt(exEl.value, 10));
    },
    addWeekly: function() {
      const stat = root.querySelector('#wk-stat').value;
      const name = root.querySelector('#wk-name').value;
      const exp = parseInt(root.querySelector('#wk-exp').value, 10);
      const days = root.querySelector('#wk-days').value;
      addWeeklyQuest(stat, name, exp, days);
    },
    toggleAdmin: function() {
      if (adminMode) { adminMode = false; render(); return; }
      const pw = window.prompt('관리자 비밀번호를 입력하세요');
      if (pw === null) return;
      if (pw === '5951') { adminMode = true; render(); }
      else { showToast('비밀번호가 틀렸어요'); }
    },
    aiParse: parseWithAI,
    aiToggle: toggleAISuggestion,
    aiAdd: addAISuggestions,
    completeSub: completeSubQuest,
    removeSub: removeSubQuest,
    acceptPromo: acceptPromotion,
    dismissPromo: dismissPromotion,
    recalibrate: recalibrateRoutine,
    dismissTier: dismissTierNotice,
    wizardChoice: wizardChoice,
    wizardMultiToggle: wizardMultiToggle,
    wizardMultiNext: wizardMultiNext,
    wizardTextNext: wizardTextNext,
    wizardBack: wizardBack,
    wizardRestart: wizardRestart,
    wizardCollapse: wizardCollapse,
    retryGenerate: function() { onboardState = 'idle'; render(); },
    openSettings: function() {
      const cur = getApiKey();
      const val = window.prompt('Gemini API 키를 입력하세요 (Google AI Studio에서 발급, AIza... 형식). 이 브라우저에만 저장되고 서버로 전송되지 않아요.', cur);
      if (val === null) return;
      applyNewKeyAndRetry(val.trim());
    },
    saveInlineKey: function() {
      const input = root.querySelector('#inline-api-key-input');
      const val = input ? input.value.trim() : '';
      if (!val) { showToast('키를 먼저 붙여넣어주세요'); return; }
      applyNewKeyAndRetry(val);
    },
  };

  root.innerHTML = '<div class="loading">캐릭터 시트를 불러오는 중…</div>';
  loadAll();
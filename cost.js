/* 이번 달 Gemini 사용 요금 (이 기기 기준 예상) — 메모·매듭짓기·목소리가 같이 쓴다.
   localStorage nuema_cost_v1 = {'2026-10': {memo: 원, knot: 원, voice: 원, n: 호출 수}}
   값은 구글 가격표(유료, 1M 토큰당 달러)로 앱이 계산한 대략치다. 정확한 금액은 AI Studio 사용량에서 본다. */
(function(){
  const KRW = 1400, KEY = 'nuema_cost_v1';
  // [이름 앞부분, 입력, 출력, 오디오 입력]. 위에서부터 앞부분이 맞는 첫 줄을 쓴다 (긴 이름을 먼저)
  const PRICES = [
    ['gemini-3.8-flash-lite-tts', .5, 6], ['gemini-3.8-flash-tts', .5, 9],
    ['gemini-3.1-flash-tts', 1, 20], ['gemini-2.5-pro-preview-tts', 1, 20], ['gemini-2.5-flash-preview-tts', .5, 10],
    ['gemini-3.8-flash', .75, 3.75], ['gemini-3.6-flash', .75, 3.75], ['gemini-3.5-flash-lite', .3, 2.5],
    ['gemini-3.1-flash-lite', .25, 1.5, .5], ['gemini-3.1-pro', 2, 12], ['gemini-3-pro', 2, 12], ['gemini-3-flash', .5, 3, 1],
    ['gemini-2.5-flash-lite', .1, .4, .3], ['gemini-2.5-flash', .3, 2.5, 1], ['gemini-2.5-pro', 1.25, 10],
    ['gemini-2.0-flash-lite', .075, .3], ['gemini-2.0-flash', .1, .4, .7], ['gemini-4', 2, 10]
  ];
  const UNKNOWN = ['', .75, 3.75];   // 표에 없는 모델은 3.8 Flash 값으로 어림
  const price = m => PRICES.find(p => String(m || '').startsWith(p[0])) || UNKNOWN;
  const month = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const load = () => { try{ return JSON.parse(localStorage.getItem(KEY)) || {}; }catch(e){ return {}; } };
  function add(where, won){
    if (!(won > 0)) return;
    const all = load(), m = all[month()] || (all[month()] = {});
    m[where] = (m[where] || 0) + won; m.n = (m.n || 0) + 1;
    try{ localStorage.setItem(KEY, JSON.stringify(all)); }catch(e){}
    window.dispatchEvent(new Event('nuema-cost'));
  }
  window.NuemaCost = {
    // generateContent 응답의 usageMetadata 로 계산 (녹음 받아쓰기의 오디오 입력은 따로 값을 매긴다)
    addUsage(where, model, u){
      if (!u) return;
      const [, pin, pout, paudio] = price(model);
      const audio = (u.promptTokensDetails || []).filter(x => x.modality === 'AUDIO').reduce((a, x) => a + (x.tokenCount || 0), 0);
      const input = (u.promptTokenCount || 0) - audio, output = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
      add(where, (input * pin + audio * (paudio || pin) + output * pout) / 1e6 * KRW);
    },
    // 음성 만들기: 소리 1초 = 25토큰, 글은 한 글자 1토큰으로 넉넉히 잡는다
    addTts(where, model, seconds, chars){
      const [, pin, pout] = price(model);
      add(where, ((chars || 0) * pin + (seconds || 0) * 25 * pout) / 1e6 * KRW);
    },
    month(key){ const m = load()[key || month()] || {}; return {memo: m.memo || 0, knot: m.knot || 0, voice: m.voice || 0, n: m.n || 0, total: (m.memo || 0) + (m.knot || 0) + (m.voice || 0)}; },
    lastMonthKey(){ const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return month(d); },
    won: n => n < 10 && n > 0 ? n.toFixed(1) : Math.round(n).toLocaleString(),
    // 다른 탭(iframe)에서 늘어나도 알 수 있게
    onChange(fn){ window.addEventListener('nuema-cost', fn); window.addEventListener('storage', e => { if (e.key === KEY) fn(); }); }
  };
})();

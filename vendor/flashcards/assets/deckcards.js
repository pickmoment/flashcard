/*!
 * deckcards — flashcards 덱 엔진
 *
 * 선언적 덱 스펙(JSON) 하나를 `references/base.html` 에 주입해 **단일 HTML 플래시카드 앱**을 만든다.
 * 렌더·flip·퀴즈·프레젠테이션 로직은 base.html 이 이미 갖고 있다 — 이 엔진은 그 파일을
 * 다시 쓰지 않고 **교체 가능한 자리(CONFIG · DECK · 색 · 카드 비율 · mermaid CDN)만** 갈아끼운다.
 * 스킬 문서(SKILL.md §0-3, template.md §1-2)가 정한 계약이 그대로 코드가 되어 있다.
 *
 * Node 와 브라우저에서 같은 파일이 돈다 (UMD). Node 전용 부분은 base.html 을 디스크에서
 * 읽는 것뿐이고, `toHTML(spec, { base })` 로 소스를 주입하면 우회된다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FCD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '0.1.0';

  /* ==========================================================================
     카탈로그 — 앱의 폼과 CLI 의 `info` 가 같은 표를 읽는다
     ========================================================================== */

  /** 카드 형식. fields 는 편집·검증 양쪽이 쓰는 필드 목록이다. */
  var CARD_TYPES = {
    basic: {
      label: '기본',
      use: '정의 · 개념 · 용어 · Q&A',
      required: ['front', 'back'],
      fields: ['front', 'back', 'note', 'choices']
    },
    cloze: {
      label: '빈칸 채우기',
      use: '문장 속 핵심어 · 수치 · 문법. 답이 문맥 안에 있어야 의미 있을 때',
      required: ['text'],
      fields: ['text', 'note']
    },
    sequence: {
      label: '순서 배열',
      use: '절차 · 단계 · 프로세스. 앞면은 섞여 나오고 뒷면이 올바른 순서다',
      required: ['front', 'items'],
      fields: ['front', 'items', 'note']
    }
  };

  var QUIZ_MODES = {
    off: '카드 학습만 — 퀴즈 탭이 숨는다',
    auto: 'basic 은 객관식(오답 부족하면 주관식), cloze 는 빈칸 타이핑',
    choice: '가능한 카드는 전부 객관식',
    typing: '전부 주관식 타이핑 — 철자·표기 암기'
  };

  /**
   * 포인트색 프리셋. 값은 밝은 모드 기준 한 색이고 나머지는 계산한다.
   *
   * 전부 흰 카드 위에서 4.5:1 을 넘긴다 — 이 색으로 나오는 것이 답의 **굵게**,
   * 즉 본문 글자이기 때문이다(base.html 의 `.back-a strong`). 톤이 예쁜 밝은 파랑·틸은
   * 4.1~3.7:1 이라 답이 흐릿해져서 한 단계 어두운 값을 골랐다.
   */
  var ACCENTS = {
    indigo: { label: '인디고', hex: '#3b5bdb' },
    teal: { label: '틸', hex: '#0f766e' },
    emerald: { label: '에메랄드', hex: '#047857' },
    amber: { label: '앰버', hex: '#b45309' },
    rose: { label: '로즈', hex: '#e11d48' },
    violet: { label: '바이올렛', hex: '#7c3aed' },
    slate: { label: '슬레이트', hex: '#475569' },
    sky: { label: '스카이', hex: '#0369a1' }
  };

  /** 카드 비율 — 답이 길면 세로를 늘린다. */
  var RATIOS = {
    '8/5': '기본 — 짧은 답',
    '7/5': '답이 긴 덱',
    '3/2': '가로로 넓게',
    '1/1': '정사각 — 이미지 카드'
  };

  var CARD_KEYS = ['id', 'type', 'category', 'context', 'front', 'back', 'text', 'items', 'choices', 'note'];

  /* ==========================================================================
     문자열 — base.html 의 plain() · clozeAnswers() · hasMermaid() 를 그대로 옮겼다.
     검증이 산출물과 다른 눈으로 보면 경고가 거짓말이 된다.
     ========================================================================== */

  function plain(s) {
    return String(s == null ? '' : s)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\*\*|\*|`|_{2,}/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function clozeAnswers(text) {
    var out = [], re = /\{\{([^}]+)\}\}/g, m;
    while ((m = re.exec(String(text == null ? '' : text))) !== null) out.push(m[1].trim());
    return out;
  }

  function hasMermaid(card) { return /```mermaid/.test((card && card.back) || ''); }

  /** 이미지 참조 목록 — `![alt](src)` 의 src 만. */
  function imageSrcs(card) {
    var out = [], re = /!\[[^\]]*\]\(([^)]+)\)/g, m;
    ['front', 'back', 'text', 'note'].forEach(function (k) {
      var v = card && card[k];
      if (typeof v !== 'string') return;
      re.lastIndex = 0;
      while ((m = re.exec(v)) !== null) out.push(m[1].trim());
    });
    return out;
  }

  /** 문장 수 — "뒷면이 3문장을 넘으면 카드를 쪼갠다" 규칙을 재는 데 쓴다. */
  function sentences(s) {
    var t = plain(s);
    if (!t) return 0;
    return t.split(/(?:[.!?。？！]+\s+|[.!?。？！]+$|\n+)/).filter(function (x) { return x.trim().length > 1; }).length || 1;
  }

  function norm(s) {
    return plain(s).toLowerCase().replace(/[\s.,!?;:'"()[\]{}·…\-—]/g, '');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ==========================================================================
     색 — 프리셋/HEX 하나에서 라이트·다크 6값을 만든다.
     base.html 이 요구하는 것은 세 값(--accent · --accent-lite · --accent-tint)과
     다크 모드의 세 값이다. 손으로 여섯 개를 맞추면 그라디언트·배지 tint 가 어긋난다.
     ========================================================================== */

  function hex2rgb(h) {
    var s = String(h).trim().replace(/^#/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }

  function rgb2hex(c) {
    return '#' + c.map(function (v) {
      var n = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return n.length < 2 ? '0' + n : n;
    }).join('');
  }

  function mix(c, target, k) {
    return [c[0] + (target[0] - c[0]) * k, c[1] + (target[1] - c[1]) * k, c[2] + (target[2] - c[2]) * k];
  }

  function rgba(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
  }

  /** HEX 문자열이든 [r,g,b] 든 받는다 — UI 가 색 문자열을 그대로 넘긴다. */
  function toRgb(c) {
    if (Array.isArray(c)) return c;
    return hex2rgb(c);
  }

  /** 상대 휘도 (WCAG). 대비를 재는 데 쓴다. */
  function luminance(c) {
    var f = toRgb(c).map(function (v) {
      var x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }

  /** 두 색의 대비비. 4.5:1 이 본문 기준선이다. 알 수 없는 색이면 NaN. */
  function contrast(a, b) {
    if (!toRgb(a) || !toRgb(b)) return NaN;
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** accent 하나 → 라이트·다크 팔레트. 문자열은 프리셋 이름 또는 HEX. */
  function palette(accent) {
    var key = typeof accent === 'string' ? accent.trim() : '';
    var hex = ACCENTS[key] ? ACCENTS[key].hex : key || ACCENTS.indigo.hex;
    var base = hex2rgb(hex);
    if (!base) return null;
    var white = [255, 255, 255];
    var lite = mix(base, white, 0.22);
    var darkAccent = mix(base, white, 0.34);
    var darkLite = mix(base, white, 0.55);
    return {
      hex: rgb2hex(base),
      accent: rgb2hex(base),
      lite: rgb2hex(lite),
      tint: rgba(base, 0.11),
      dark: rgb2hex(darkAccent),
      darkLite: rgb2hex(darkLite),
      darkTint: rgba(darkAccent, 0.16),
      /* 카드 배경(#fff / #1c1f26) 위 대비 — 답의 **굵게** 가 이 색으로 나온다 */
      contrastLight: contrast(base, [255, 255, 255]),
      contrastDark: contrast(darkAccent, [28, 31, 38])
    };
  }

  /* ==========================================================================
     스펙 정규화 — 앱·CLI·검증이 같은 모양을 본다
     ========================================================================== */

  var CONFIG_DEFAULTS = {
    id: '', title: '', subtitle: '', story: false, quiz: 'auto', reverse: false, autoplaySec: 6
  };

  function normalize(spec) {
    var s = spec && typeof spec === 'object' ? spec : {};
    var cards = Array.isArray(s.cards) ? s.cards : [];
    return {
      config: {
        id: str(s.id),
        title: str(s.title),
        subtitle: str(s.subtitle),
        story: !!s.story,
        quiz: s.quiz == null ? 'auto' : String(s.quiz),
        reverse: !!s.reverse,
        autoplaySec: s.autoplaySec == null ? 6 : Number(s.autoplaySec)
      },
      accent: s.accent == null || s.accent === '' ? 'indigo' : String(s.accent),
      ratio: s.ratio == null || s.ratio === '' ? '8/5' : String(s.ratio),
      cards: cards.map(normalizeCard)
    };
  }

  function str(v) { return v == null ? '' : String(v); }

  /** 형식에 맞는 필드만 남긴다 — 형식을 바꾸다 남은 필드가 산출물에 섞이지 않게. */
  function normalizeCard(card) {
    var c = card && typeof card === 'object' ? card : {};
    var type = c.type == null || c.type === '' ? 'basic' : String(c.type);
    var out = { id: c.id, type: type };
    if (c.category != null && c.category !== '') out.category = String(c.category);
    if (c.context != null && c.context !== '') out.context = String(c.context);
    if (type === 'cloze') {
      out.text = str(c.text);
    } else if (type === 'sequence') {
      out.front = str(c.front);
      out.items = (Array.isArray(c.items) ? c.items : []).map(str);
    } else {
      out.front = str(c.front);
      out.back = str(c.back);
      if (Array.isArray(c.choices) && c.choices.length) out.choices = c.choices.map(str);
    }
    if (c.note != null && c.note !== '') out.note = String(c.note);
    return out;
  }

  /** 카드를 CARD_KEYS 순서로 다시 담는다 — 산출물 diff 가 흔들리지 않게. */
  function orderKeys(card) {
    var out = {};
    CARD_KEYS.forEach(function (k) { if (card[k] !== undefined) out[k] = card[k]; });
    Object.keys(card).forEach(function (k) { if (out[k] === undefined) out[k] = card[k]; });
    return out;
  }

  function nextId(cards) {
    var max = 0;
    (cards || []).forEach(function (c) {
      var n = Number(c && c.id);
      if (isFinite(n) && n > max) max = Math.floor(n);
    });
    return max + 1;
  }

  function blankCard(type, id) {
    var t = CARD_TYPES[type] ? type : 'basic';
    if (t === 'cloze') return { id: id, type: 'cloze', text: '' };
    if (t === 'sequence') return { id: id, type: 'sequence', front: '', items: ['', ''] };
    return { id: id, type: 'basic', front: '', back: '' };
  }

  /* ==========================================================================
     퀴즈 성립 여부 — base.html 의 quizMode()·distractors() 와 같은 판정.
     "객관식으로 나올 줄 알았는데 주관식이었다" 를 만들지 않기 위해 여기서 미리 센다.
     ========================================================================== */

  function distractorCount(cards, card) {
    var answer = plain(card.back);
    var seen = {}, n = 0;
    (card.choices || []).forEach(function (t) {
      var p = plain(t);
      if (p && p !== answer && !seen[p]) { seen[p] = 1; n++; }
    });
    cards.forEach(function (c) {
      if (c.id === card.id || c.type === 'cloze' || c.type === 'sequence' || hasMermaid(c) || !c.back) return;
      var p = plain(c.back);
      if (p && p !== answer && !seen[p]) { seen[p] = 1; n++; }
    });
    return n;
  }

  /** null 이면 출제에서 빠진다. 'choice' | 'typing' | 'blank'. */
  function quizModeOf(cards, card, quiz) {
    if (quiz === 'off') return null;
    if (card.type === 'cloze') return clozeAnswers(card.text).length ? 'blank' : null;
    if (card.type === 'sequence' || hasMermaid(card)) return null;
    if (!plain(card.back)) return null;
    if (quiz === 'typing') return 'typing';
    return distractorCount(cards, card) >= 2 ? 'choice' : 'typing';
  }

  /* ==========================================================================
     검증 — 오류(✗)는 산출물이 깨지는 것, 경고(!)는 학습 설계에 대한 지적이다
     ========================================================================== */

  function validate(spec) {
    var E = [], W = [], n = normalize(spec), C = n.config, cards = n.cards;

    /* ---- 루트 ---- */
    if (!C.id) E.push('id 가 없다 — localStorage 키다. `flashcards-<주제>-v1` 형태로 적는다');
    /* localStorage 키라 값 자체는 자유지만, 공백과 인용부호는 막는다 — 이 값이 문서의
       `CONFIG.id` 문자열 리터럴로 들어가고 사람이 키를 손으로 찾을 때도 걸린다 */
    else if (!/^[^\s"'\\]+$/.test(C.id)) E.push('id 에 공백이나 인용부호를 쓰지 않는다: ' + C.id);
    if (!C.title) E.push('title 이 없다 — 헤더와 발표 타이틀 슬라이드에 쓰인다');
    if (!QUIZ_MODES[C.quiz]) E.push('quiz 값이 잘못됐다: ' + C.quiz + ' (' + Object.keys(QUIZ_MODES).join(' · ') + ')');
    if (!isFinite(C.autoplaySec) || C.autoplaySec < 1 || C.autoplaySec > 120)
      E.push('autoplaySec 는 1~120 초 사이 숫자다: ' + C.autoplaySec);
    if (!palette(n.accent)) E.push('accent 를 알 수 없다: ' + n.accent + ' (프리셋 ' + Object.keys(ACCENTS).join('·') + ' 또는 #RRGGBB)');
    if (!/^\d+(\.\d+)?\/\d+(\.\d+)?$/.test(n.ratio)) E.push('ratio 는 `가로/세로` 형태다: ' + n.ratio);

    if (!cards.length) {
      E.push('카드가 없다 — cards 배열에 최소 한 장이 필요하다');
      return { ok: false, errors: E, warnings: W, stats: stats(spec), cards: [] };
    }

    /* ---- 카드별 ---- */
    var ids = {}, fronts = {}, rows = [];
    cards.forEach(function (c, i) {
      var at = '카드 ' + (i + 1) + (c.id != null ? '(id ' + c.id + ')' : ''), issues = [];
      var num = Number(c.id);
      if (c.id == null || c.id === '') issues.push('id 가 없다 — localStorage 상태가 카드와 어긋난다');
      else if (!isFinite(num) || Math.floor(num) !== num) issues.push('id 는 정수다: ' + c.id);
      else if (ids[num]) issues.push('id 가 중복됐다: ' + num);
      else ids[num] = 1;

      if (!CARD_TYPES[c.type]) {
        issues.push('모르는 형식이다: ' + c.type + ' (' + Object.keys(CARD_TYPES).join(' · ') + ')');
      } else if (c.type === 'cloze') {
        if (!c.text.trim()) issues.push('cloze 는 text 가 필요하다');
        else if (!clozeAnswers(c.text).length) issues.push('cloze 에 빈칸이 없다 — 외울 곳을 {{ }} 로 감싼다');
        else if (clozeAnswers(c.text).some(function (a) { return !a; })) issues.push('빈 빈칸이 있다: {{}}');
        if (clozeAnswers(c.text).length > 5) W.push(at + ': 빈칸이 ' + clozeAnswers(c.text).length + '개다 — 4개를 넘으면 문장이 암호가 된다. 쪼갠다');
      } else if (c.type === 'sequence') {
        if (!c.front.trim()) issues.push('sequence 는 front(질문) 가 필요하다');
        if (c.items.length < 2) issues.push('sequence 는 items 가 2개 이상이어야 한다 (올바른 순서로 적는다)');
        else if (c.items.some(function (x) { return !x.trim(); })) issues.push('빈 항목이 있다');
        if (c.items.length > 7) W.push(at + ': 단계가 ' + c.items.length + '개다 — 7개를 넘으면 한 카드로 외우기 어렵다');
      } else {
        if (!c.front.trim()) issues.push('front(질문) 가 없다');
        if (!c.back.trim()) issues.push('back(답) 가 없다');
      }

      /* 내용 품질 — 오류가 아니라 지적 */
      var frontText = c.type === 'cloze' ? plain(c.text) : plain(c.front);
      var backText = c.type === 'cloze' ? '' : c.type === 'sequence' ? c.items.join(' ') : plain(c.back);
      if (frontText.length > 90) W.push(at + ': 앞면이 ' + frontText.length + '자다 — 발표 모드에서 글자가 축소된다. 짧은 질문이 크게 나온다');
      if (c.type === 'basic' && sentences(c.back) > 3)
        W.push(at + ': 뒷면이 ' + sentences(c.back) + '문장이다 — 3문장을 넘으면 카드를 쪼갠다');
      if (backText.length > 400)
        W.push(at + ': 뒷면이 ' + backText.length + '자다 — 한 카드에 담기 너무 많다. 쪼갠다');
      if (c.type === 'basic' && backText.length >= 6 && frontText.toLowerCase().indexOf(backText.toLowerCase()) >= 0)
        W.push(at + ': 앞면에 답이 그대로 들어 있다 — flip 할 이유가 없어진다');
      if (c.choices && c.choices.length === 1)
        W.push(at + ': choices 가 1개다 — 객관식은 오답 2개 이상이 필요하다. 비우면 다른 카드 답에서 자동으로 뽑는다');
      if (C.story && !c.context)
        W.push(at + ': 스토리라인 덱인데 context("지금까지: …") 가 없다');

      imageSrcs(c).forEach(function (src) {
        if (!/^(data:|https?:)/i.test(src))
          W.push(at + ': 이미지가 외부 경로다 (' + src + ') — 단일 파일이 아니게 된다. 작은 그림은 data URI 로 심는다');
      });

      /* 앞면이 그림인 카드는 글자로 비교할 수 없다 — 질문은 그림이고 alt·안내 문구는
         여러 장이 똑같이 "이건 무엇인가" 로 겹치는 것이 정상이다 */
      var key = imageSrcs({ front: c.front, text: c.text }).length ? '' : norm(frontText);
      if (key) {
        if (fronts[key]) W.push(at + ': 앞면이 카드 ' + fronts[key] + ' 과 같다 — 같은 개념을 두 번 묻고 있다');
        else fronts[key] = i + 1;
      }

      rows.push({
        n: i + 1, id: c.id, type: c.type, category: c.category || null,
        label: (frontText || '(빈 카드)').slice(0, 42),
        chars: frontText.length + backText.length,
        quiz: CARD_TYPES[c.type] ? quizModeOf(cards, c, C.quiz) : null,
        issues: issues
      });
      issues.forEach(function (m) { E.push(at + ': ' + m); });
    });

    /* ---- 덱 전체 ---- */
    var st = stats(spec);
    if (cards.length < 3) W.push('카드가 ' + cards.length + '장이다 — 덱으로 돌릴 만한 분량이 아니다');
    if (cards.length > 60) W.push('카드가 ' + cards.length + '장이다 — 한 번에 외우기 어렵다. 주제별로 덱을 쪼갠다');
    if (st.categories.length < 2 && cards.length >= 15)
      W.push('카드 ' + cards.length + '장이 카테고리 한 종류다 — 칩 필터가 나오지 않는다. 갈래를 나눈다');
    if (st.categories.length >= 2 && st.uncategorized)
      W.push('카테고리가 ' + st.categories.length + '종인데 ' + st.uncategorized + '장은 비어 있다 — 그 카드는 칩 필터에서 빠진다');
    if (C.quiz !== 'off' && !st.quiz.total)
      W.push('퀴즈에 낼 수 있는 카드가 없다 — 퀴즈 탭이 숨는다 (sequence·mermaid·이미지/코드뿐인 답은 출제에서 빠진다)');
    else if (C.quiz === 'auto' && st.quiz.choice === 0 && st.quiz.typing > 0)
      W.push('덱이 작아 객관식이 성립하지 않는다 — ' + st.quiz.typing + '장이 주관식으로 폴백된다');
    if (!C.story && cards.length >= 3 && st.withContext === cards.length)
      W.push('모든 카드에 context 가 있다 — 스토리라인 덱이면 story: true 로 켠다(셔플 기본 OFF)');
    if (C.reverse && st.types.basic !== cards.length)
      W.push('reverse(양방향) 는 basic 카드에만 의미가 있다 — cloze·sequence 는 뒤→앞이 성립하지 않는다');
    if (st.excludedFromQuiz && C.quiz !== 'off')
      W.push(st.excludedFromQuiz + '장은 퀴즈에서 빠진다 (sequence · mermaid · 답이 코드/이미지뿐)');

    var pal = palette(n.accent);
    if (pal && pal.contrastLight < 4.5)
      W.push('포인트색이 흰 카드 위에서 대비 ' + pal.contrastLight.toFixed(1) + ':1 이다 — 답의 **굵게** 가 읽히지 않는다 (4.5:1 이상)');

    var dup = duplicateConcepts(cards);
    dup.forEach(function (d) {
      W.push('카드 ' + d[0] + ' 과 ' + d[1] + ' 이 같은 개념을 basic·cloze 로 중복 출제한다');
    });

    return { ok: !E.length, errors: E, warnings: W, stats: st, cards: rows };
  }

  /** basic 의 답이 cloze 의 빈칸 답과 같은 쌍 — SKILL.md §2 "중복 출제 금지". */
  function duplicateConcepts(cards) {
    var out = [];
    cards.forEach(function (a, i) {
      if (a.type !== 'basic' || !a.back) return;
      var key = norm(a.back);
      if (!key) return;
      cards.forEach(function (b, j) {
        if (b.type !== 'cloze') return;
        var hit = clozeAnswers(b.text).some(function (ans) { return norm(ans) === key; });
        if (hit) out.push([i + 1, j + 1]);
      });
    });
    return out;
  }

  function stats(spec) {
    var n = normalize(spec), cards = n.cards, C = n.config;
    var types = { basic: 0, cloze: 0, sequence: 0 }, cats = [], uncategorized = 0;
    var quiz = { choice: 0, typing: 0, blank: 0, total: 0 };
    var mermaid = 0, images = 0, externalImages = 0, blanks = 0, withContext = 0, chars = 0, excluded = 0;

    cards.forEach(function (c) {
      if (types[c.type] === undefined) types[c.type] = 0;
      types[c.type]++;
      if (c.category) { if (cats.indexOf(c.category) < 0) cats.push(c.category); } else uncategorized++;
      if (c.context) withContext++;
      if (hasMermaid(c)) mermaid++;
      imageSrcs(c).forEach(function (src) {
        images++;
        if (!/^(data:|https?:)/i.test(src)) externalImages++;
      });
      if (c.type === 'cloze') blanks += clozeAnswers(c.text).length;
      chars += plain(c.front || c.text || '').length + plain(c.back || (c.items || []).join(' ')).length;
      var m = CARD_TYPES[c.type] ? quizModeOf(cards, c, C.quiz) : null;
      if (m) { quiz[m]++; quiz.total++; } else if (C.quiz !== 'off') excluded++;
    });

    var pal = palette(n.accent);
    return {
      cards: cards.length,
      types: types,
      categories: cats,
      uncategorized: uncategorized,
      quiz: quiz,
      excludedFromQuiz: excluded,
      mermaid: mermaid,
      images: images,
      externalImages: externalImages,
      clozeBlanks: blanks,
      withContext: withContext,
      chars: chars,
      accent: pal ? pal.hex : n.accent,
      ratio: n.ratio,
      quizMode: C.quiz,
      story: C.story,
      reverse: C.reverse,
      /* 발표 자동재생으로 한 바퀴 도는 데 걸리는 시간 (공개→다음 2단계) */
      autoplaySec: C.autoplaySec,
      autoplayTotalSec: cards.length * C.autoplaySec * 2
    };
  }

  /* ==========================================================================
     빌드 — base.html 의 교체 가능한 자리만 갈아끼운다
     ========================================================================== */

  var ANCHORS = {
    /* 이 블록 하나만 교체하면 새 덱이 된다 (template.md §1) */
    dataStart: 'const CONFIG = {',
    dataEnd: '/* ==========================================================================\n   2. markdown',
    title: /<title>[\s\S]*?<\/title>/,
    mermaidOn: '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>',
    mermaidOff: '<!-- <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script> -->',
    /**
     * mermaid CDN 줄 **전체**. 주석 여부를 포함해 잡아야 한다 — `mermaidOn` 문자열은
     * 이미 주석 처리된 줄의 부분집합이라, 그것만 보고 감싸면 `<!-- <!-- … --> -->` 가 되고
     * HTML 주석은 중첩되지 않으므로 바깥 `-->` 가 본문 글자로 새어 나온다.
     */
    mermaidLine: /^(?:<!-- )?<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@11\/dist\/mermaid\.min\.js"><\/script>(?: -->)?$/m,
    /* 라이트 → 다크 순으로 두 번 나온다 (:root 와 prefers-color-scheme 블록) */
    accents: /(\n\s*)--accent:#[0-9a-fA-F]{3,6}; --accent-lite:#[0-9a-fA-F]{3,6}; --accent-tint:rgba\([^)]*\);/g,
    ratio: /aspect-ratio:\d+(?:\.\d+)?\/\d+(?:\.\d+)?;/
  };

  /**
   * 덱 스펙 → 단일 HTML.
   *
   * @param {object} spec  덱 스펙
   * @param {object} opts  { base: base.html 소스(필수), preview: 검수 훅을 얹는다 }
   */
  function toHTML(spec, opts) {
    opts = opts || {};
    var base = opts.base;
    if (typeof base !== 'string' || !base) throw new Error('base.html 소스가 필요하다 — toHTML(spec, { base })');

    var n = normalize(spec), pal = palette(n.accent);
    if (!pal) throw new Error('accent 를 알 수 없다: ' + n.accent);

    var i0 = base.indexOf(ANCHORS.dataStart);
    var i1 = base.indexOf(ANCHORS.dataEnd);
    if (i0 < 0 || i1 < 0 || i1 < i0)
      throw new Error('base.html 에서 CONFIG·DECK 블록을 찾지 못했다 — 템플릿 구조가 바뀌었다');

    var html = base.slice(0, i0) + dataBlock(n) + base.slice(i1);

    /* 제목 */
    html = html.replace(ANCHORS.title, '<title>' + esc(n.config.title || '플래시카드') + '</title>');

    /* 색 — :root 와 다크 모드 블록 두 곳. 등장 순서가 라이트 → 다크다 */
    var hit = 0;
    html = html.replace(ANCHORS.accents, function (m, lead) {
      hit++;
      return hit === 1
        ? lead + '--accent:' + pal.accent + '; --accent-lite:' + pal.lite + '; --accent-tint:' + pal.tint + ';'
        : lead + '--accent:' + pal.dark + '; --accent-lite:' + pal.darkLite + '; --accent-tint:' + pal.darkTint + ';';
    });
    if (hit !== 2) throw new Error('base.html 에서 포인트색 두 곳을 찾지 못했다 (찾은 곳 ' + hit + ')');

    /* 카드 비율 — 첫 등장이 .card 규칙이다 (모바일 미디어쿼리는 aspect-ratio:auto) */
    html = html.replace(ANCHORS.ratio, 'aspect-ratio:' + n.ratio + ';');

    /* mermaid CDN — 카드가 있을 때만 싣는다. 줄을 통째로 갈아 끼우므로 몇 번 돌려도 같다 */
    var needMermaid = n.cards.some(hasMermaid);
    if (!ANCHORS.mermaidLine.test(html))
      throw new Error('base.html 에서 mermaid CDN 줄을 찾지 못했다 — 템플릿 구조가 바뀌었다');
    html = html.replace(ANCHORS.mermaidLine, needMermaid ? ANCHORS.mermaidOn : ANCHORS.mermaidOff);

    if (opts.preview) html = html.replace('</body>', previewHook() + '</body>');
    return html;
  }

  /** CONFIG · DECK 블록. template.md §6 의 검증 정규식이 읽을 수 있는 모양을 지킨다. */
  function dataBlock(n) {
    var cards = n.cards.map(orderKeys);
    return 'const CONFIG = ' + JSON.stringify(n.config, null, 2) + ';\n\n' +
      'const DECK = ' + JSON.stringify(cards, null, 2) + ';\n\n';
  }

  /**
   * 검수 훅 — 앱의 미리보기가 카드를 짚어 보는 데만 쓴다.
   *
   * base.html 의 최상위 함수(`render`·`flip`·`setView`·`presEnter`…)를 **부르기만** 한다.
   * 로직을 복제하지 않으므로 미리보기와 산출물이 어긋날 수 없다. 일반 빌드에는 실리지 않는다.
   */
  function previewHook() {
    return '<script>\n' +
      '/* flashcard 앱 미리보기 훅 — `preview` 빌드에만 실린다 */\n' +
      'window.FCP = {\n' +
      '  version: ' + JSON.stringify(VERSION) + ',\n' +
      '  cards: DECK.map(function (c) { return { id: c.id, type: c.type || "basic", category: c.category || null }; }),\n' +
      '  goto: function (id) {\n' +
      '    var i = state.order.indexOf(id);\n' +
      '    if (i < 0) return false;\n' +
      '    state.index = i; state.flipped = false; render(); return true;\n' +
      '  },\n' +
      '  flip: function (v) { flip(v); return state.flipped; },\n' +
      '  view: function (v) { setView(v); return v; },\n' +
      '  present: function (on) { if (on === false) presExit(); else presEnter(); return !!pres.on; },\n' +
      '  reveal: function () { if (pres.on) presNext(); },\n' +
      '  category: function (c) { state.cat = c || "all"; buildOrder(false); renderChips(); render(); return state.cat; },\n' +
      '  reset: function () { try { localStorage.removeItem(CONFIG.id); } catch (e) {} restart(true); },\n' +
      '  state: function () {\n' +
      '    return { index: state.index, id: state.order[state.index] == null ? null : state.order[state.index],\n' +
      '             total: state.order.length, flipped: state.flipped, category: state.cat,\n' +
      '             view: document.getElementById("view-quiz").hidden ? "study" : "quiz", present: !!pres.on };\n' +
      '  }\n' +
      '};\n' +
      '</script>\n';
  }

  /* ==========================================================================
     산출물 기계 검수 — 앱과 CLI 가 같은 눈으로 본다.
     "자기 선언" 을 믿지 않고 산출물 문자열을 직접 본다.
     ========================================================================== */

  function check(html) {
    var lines = [], fail = 0;
    function must(label, ok, why) {
      lines.push({ ok: !!ok, label: label, why: ok ? undefined : why });
      if (!ok) fail++;
    }
    function never(label, hit, why) {
      lines.push({ ok: !hit, label: label, why: hit ? why : undefined });
      if (hit) fail++;
    }

    must('lang="ko"', /<html lang="ko">/.test(html), '한국어 문서 선언');
    must('한국어 줄바꿈(keep-all)', /word-break:\s*keep-all/.test(html), '단어 중간에서 줄이 꺾이면 가독성이 떨어진다');
    must('감소 모션 대응', /prefers-reduced-motion/.test(html), 'flip 3D 회전의 정적 대체가 필요하다');
    must('다크 모드', /prefers-color-scheme:\s*dark/.test(html), '카드 색이 OS 설정을 따라야 한다');
    must('스크린리더 라벨', /aria-label=/.test(html), '조작부에 라벨이 필요하다');
    must('진행 저장', /localStorage/.test(html), '카드별 ✓/✗ 와 마지막 위치를 저장한다');
    must('CONFIG 블록', /const CONFIG = \{[\s\S]*?\n\};/.test(html), 'localStorage 키·제목·퀴즈 모드');

    /* template.md §6 가 쓰는 정규식 그대로 — 문서화된 검증 경로가 계속 통해야 한다 */
    var deckMatch = html.match(/const DECK = (\[[\s\S]*?\n\]);/);
    must('DECK 블록', !!deckMatch, '카드 데이터를 찾지 못했다 (template.md §6 의 검증 명령도 함께 깨진다)');

    var script = html.match(/<script>([\s\S]*?)<\/script>/);
    var syntax = null;
    if (script) {
      try { new Function(script[1]); } catch (e) { syntax = e.message; }
    }
    must('스크립트 문법', !!script && !syntax, syntax || '<script> 를 찾지 못했다');

    never('제어문자 오염', /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(html),
      '리터럴 제어문자가 들어가면 HTML 파서가 U+FFFD 로 치환해 스크립트가 죽는다');
    never('이스케이프된 빈칸 태그', /&lt;span class="blank"/.test(html),
      'cloze 앞면의 <span class="blank"> 가 텍스트로 노출됐다 — md() 에 원시 HTML 을 선주입했다는 뜻이다');
    never('허용하지 않은 외부 스크립트',
      /<script[^>]+src="(?!https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@11)/.test(html),
      '단일 파일 정책 — 폰트 CDN 과 mermaid 만 허용한다');

    var cards = [], types = {};
    if (deckMatch) {
      try { cards = JSON.parse(deckMatch[1]); } catch (e) { cards = []; }
      cards.forEach(function (c) { types[(c && c.type) || 'basic'] = 1; });
    }
    var needMermaid = cards.some(hasMermaid);
    /* 주석 처리된 줄에도 같은 script 태그 문자열이 들어 있다 — 주석 여부로 판정한다 */
    var cdnOn = html.indexOf(ANCHORS.mermaidOff) < 0 && html.indexOf(ANCHORS.mermaidOn) >= 0;
    must('mermaid CDN 정합', needMermaid === cdnOn,
      needMermaid ? 'mermaid 카드가 있는데 CDN 이 꺼져 있다 — 다이어그램이 코드블록으로 나온다'
        : 'mermaid 카드가 없는데 CDN 이 실렸다 — 쓰지 않는 네트워크 의존이다');
    must('mermaid CDN 줄 형태', ANCHORS.mermaidLine.test(html),
      'CDN 줄이 예상한 모양이 아니다 — 주석이 이중으로 감싸이면 바깥 `-->` 가 본문 글자로 새어 나온다');
    never('중첩 주석', /<!--\s*<!--/.test(html),
      'HTML 주석은 중첩되지 않는다 — 바깥 닫는 표시가 화면에 글자로 보인다');

    var info = '카드 ' + cards.length + '장 · 형식 ' + Object.keys(types).length +
      '종(' + Object.keys(types).join(' ') + ') · ' + Math.round(html.length / 1024) + 'KB';
    return { lines: lines, info: info, fail: fail, cards: cards.length };
  }

  /* ==========================================================================
     가져오기 / 내보내기 — 이미 있는 단어장·표를 다시 타이핑하지 않는다
     ========================================================================== */

  function detectFormat(text) {
    var lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim() && l.trim()[0] !== '#'; });
    if (!lines.length) return 'tsv';
    var tabs = lines.filter(function (l) { return l.indexOf('\t') >= 0; }).length;
    if (tabs >= lines.length * 0.6) return 'tsv';
    var seps = lines.filter(function (l) { return /\s::\s|\s\|\s/.test(l); }).length;
    if (seps >= lines.length * 0.6) return 'md';
    var commas = lines.filter(function (l) { return l.indexOf(',') >= 0; }).length;
    if (commas >= lines.length * 0.6) return 'csv';
    return 'md';
  }

  /** RFC4180 한 줄 파서 — 인용부호 안의 구분자와 줄바꿈을 지킨다. */
  function parseDelimited(text, sep) {
    var rows = [], row = [], field = '', q = false, s = String(text);
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }

  var HEADER_WORDS = { front: 'front', back: 'back', category: 'category', note: 'note', 앞면: 'front', 뒷면: 'back', 질문: 'front', 답: 'back', 카테고리: 'category', 보충: 'note' };

  /**
   * 표·목록을 카드 배열로. 형식을 모르면 추측한다.
   * `{{ }}` 만 있고 답 칸이 비면 cloze 로, `1.`/`->` 로 이어진 항목은 sequence 로 읽는다.
   */
  function parseImport(text, opts) {
    opts = opts || {};
    var format = opts.format && opts.format !== 'auto' ? opts.format : detectFormat(text);
    var startId = opts.startId || 1;
    var warnings = [], rows = [];

    if (format === 'csv' || format === 'tsv' || format === 'anki') {
      rows = parseDelimited(String(text).replace(/^#[^\n]*\n/gm, ''), format === 'csv' ? ',' : '\t');
      var order = ['front', 'back', 'category', 'note'];
      if (rows.length && rows[0].every(function (c) { return HEADER_WORDS[c.trim().toLowerCase()]; })) {
        order = rows.shift().map(function (c) { return HEADER_WORDS[c.trim().toLowerCase()]; });
      }
      rows = rows.map(function (r) {
        var o = {};
        r.forEach(function (v, i) { if (order[i]) o[order[i]] = v.trim(); });
        return o;
      });
    } else {
      String(text).split(/\r?\n/).forEach(function (line) {
        var l = line.trim().replace(/^[-*+]\s+/, '');
        if (!l || l[0] === '#') return;
        var m = l.split(/\s+::\s+|\s+\|\s+|\s+—\s+/);
        if (m.length >= 2) rows.push({ front: m[0].trim(), back: m.slice(1).join(' | ').trim() });
        else if (/\{\{[^}]+\}\}/.test(l)) rows.push({ front: l, back: '' });
        else warnings.push('구분자(`::` · `|`)가 없어 건너뛴 줄: ' + l.slice(0, 40));
      });
    }

    var cards = [];
    rows.forEach(function (r) {
      var front = (r.front || '').trim(), back = (r.back || '').trim();
      if (!front && !back) return;
      var card;
      if (!back && /\{\{[^}]+\}\}/.test(front)) card = { id: startId + cards.length, type: 'cloze', text: front };
      else if (/(^|\s)(\d\.|->|→)/.test(back) && back.split(/\s*(?:->|→|\d\.\s*)\s*/).filter(Boolean).length >= 2)
        card = {
          id: startId + cards.length, type: 'sequence', front: front,
          items: back.split(/\s*(?:->|→)\s*|\s*\d+\.\s*/).map(function (x) { return x.trim(); }).filter(Boolean)
        };
      else card = { id: startId + cards.length, type: 'basic', front: front, back: back };
      if (r.category) card.category = r.category;
      if (r.note) card.note = r.note;
      if (card.type === 'basic' && !card.back) warnings.push('답이 비어 있다: ' + front.slice(0, 40));
      cards.push(orderKeys(card));
    });

    if (!cards.length) warnings.push('카드를 하나도 읽지 못했다 — 형식을 지정해 다시 시도한다');
    return { cards: cards, warnings: warnings, format: format };
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** 덱 → CSV. Anki·스프레드시트로 다시 넘길 때 쓴다. */
  function toCsv(spec) {
    var n = normalize(spec);
    var head = ['id', 'type', 'category', 'front', 'back', 'items', 'note'];
    var body = n.cards.map(function (c) {
      return [
        c.id, c.type, c.category || '',
        c.type === 'cloze' ? c.text : c.front,
        c.type === 'cloze' ? clozeAnswers(c.text).join(' / ') : c.type === 'sequence' ? '' : c.back,
        (c.items || []).join(' → '),
        c.note || ''
      ].map(csvCell).join(',');
    });
    return head.join(',') + '\n' + body.join('\n') + '\n';
  }

  /* ==========================================================================
     공개 표면
     ========================================================================== */

  return {
    version: VERSION,
    CARD_TYPES: CARD_TYPES,
    QUIZ_MODES: QUIZ_MODES,
    ACCENTS: ACCENTS,
    RATIOS: RATIOS,
    CARD_KEYS: CARD_KEYS,
    CONFIG_DEFAULTS: CONFIG_DEFAULTS,

    normalize: normalize,
    normalizeCard: normalizeCard,
    orderKeys: orderKeys,
    blankCard: blankCard,
    nextId: nextId,

    validate: validate,
    stats: stats,
    toHTML: toHTML,
    check: check,

    parseImport: parseImport,
    detectFormat: detectFormat,
    toCsv: toCsv,

    palette: palette,
    contrast: contrast,
    plain: plain,
    clozeAnswers: clozeAnswers,
    hasMermaid: hasMermaid,
    imageSrcs: imageSrcs,
    sentences: sentences,
    quizModeOf: quizModeOf
  };
});

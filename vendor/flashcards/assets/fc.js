#!/usr/bin/env node
/*!
 * fc — flashcards 스킬 CLI
 *
 *   node fc.js validate <deck.json>
 *   node fc.js build    <deck.json> [-o out.html] [--preview]
 *   node fc.js check    <out.html>
 *   node fc.js import   <표.csv|.tsv|.md> [-o deck.json] [--format csv|tsv|md|anki]
 *                                          [--title "덱 제목"] [--id flashcards-…-v1]
 *   node fc.js csv      <deck.json> [-o out.csv]
 *   node fc.js new      <deck.json> [--title "덱 제목"] [--id …] [--accent teal]
 *   node fc.js info     [types|quiz|accents|ratios]
 *   node fc.js test
 *
 *   --preview   미리보기 훅(window.FCP)을 얹는다 — 앱이 카드를 짚어 보는 데 쓴다
 *   --base <f>  base.html 을 다른 경로에서 읽는다 (기본: ../references/base.html)
 *
 * 덱 스펙은 CONFIG 와 DECK 을 한 파일에 담은 JSON 이다:
 *   { "id": "flashcards-js-closure-v1", "title": "…", "quiz": "auto",
 *     "accent": "indigo", "ratio": "8/5", "cards": [ … ] }
 *
 * 산출물 파일명은 원본 스펙의 이름(stem)을 그대로 잇는다 — `deck.json` → `deck.html`.
 */
'use strict';
var fs = require('fs'), path = require('path');
var FCD = require(path.join(__dirname, 'deckcards.js'));

var argv = process.argv.slice(2), cmd = argv.shift(), flags = {}, files = [];
for (var i = 0; i < argv.length; i++) {
  var a = argv[i];
  if (a === '-o' || a === '--out') flags.out = argv[++i];
  else if (a === '--format') flags.format = argv[++i];
  else if (a === '--title') flags.title = argv[++i];
  else if (a === '--id') flags.id = argv[++i];
  else if (a === '--accent') flags.accent = argv[++i];
  else if (a === '--base') flags.base = argv[++i];
  else if (a.slice(0, 2) === '--') flags[a.slice(2).replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); })] = true;
  else files.push(a);
}

function usage(code) {
  process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('/*!')[1] + '\n');
  process.exit(code || 0);
}

function die(msg) { console.error('  ✗ ' + msg); process.exit(1); }

function readSpec(f) {
  if (!f) die('덱 스펙 파일이 없다.');
  if (!fs.existsSync(f)) die('그런 파일이 없다: ' + f);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch (e) { die('JSON 파싱 실패: ' + e.message); }
}

/** base.html 소스. 스킬 안에 있는 것을 쓰고, `--base` 로 덮을 수 있다. */
function readBase() {
  var f = flags.base || path.join(__dirname, '..', 'references', 'base.html');
  if (!fs.existsSync(f)) die('base.html 을 찾지 못했다: ' + f);
  return fs.readFileSync(f, 'utf8');
}

function outPath(src, ext) {
  return flags.out || String(src).replace(/\.[^.]+$/, '') + ext;
}

/** 검증 결과를 gm 과 같은 모양으로 낸다 — ✗ 는 고치고, ! 는 이유가 있어야 무시한다. */
function report(v) {
  v.errors.forEach(function (e) { console.error('  ✗ ' + e); });
  v.warnings.forEach(function (w) { console.error('  ! ' + w); });
  var s = v.stats;
  var types = Object.keys(s.types).filter(function (k) { return s.types[k]; })
    .map(function (k) { return FCD.CARD_TYPES[k] ? FCD.CARD_TYPES[k].label + ' ' + s.types[k] : k + ' ' + s.types[k]; });
  if (v.ok) {
    console.error('  ✓ 카드 ' + s.cards + '장 (' + types.join(' · ') + ') · ' +
      (s.categories.length ? '카테고리 ' + s.categories.length + '종' : '카테고리 없음') + ' · ' +
      '퀴즈 ' + s.quizMode + '(객관식 ' + s.quiz.choice + ' · 주관식 ' + s.quiz.typing + ' · 빈칸 ' + s.quiz.blank +
      (s.excludedFromQuiz ? ' · 제외 ' + s.excludedFromQuiz : '') + ') · ' +
      s.accent + ' · ' + s.ratio + (s.story ? ' · 스토리라인' : '') + (s.reverse ? ' · 양방향' : '') +
      (s.mermaid ? ' · mermaid ' + s.mermaid : '') + (s.images ? ' · 이미지 ' + s.images : ''));
    console.error('    ' + v.cards.map(function (c) {
      return '[' + c.n + '] ' + (c.id === undefined ? '?' : c.id) + ' ' + (FCD.CARD_TYPES[c.type] || { label: c.type }).label +
        (c.category ? '(' + c.category + ')' : '') + ' ' + c.label +
        (c.quiz ? '  퀴즈:' + c.quiz : '  퀴즈:없음');
    }).join('\n    '));
  }
  return v.ok;
}

if (!cmd || flags.help || cmd === 'help') usage(cmd ? 0 : 1);

if (cmd === 'test') { require(path.join(__dirname, 'selftest.js')); return; }

if (cmd === 'validate') {
  process.exit(report(FCD.validate(readSpec(files[0]))) ? 0 : 1);
}

if (cmd === 'build') {
  var spec = readSpec(files[0]);
  var v = FCD.validate(spec);
  if (!report(v)) { console.error('  → 오류를 고치고 다시 빌드한다.'); process.exit(1); }
  var out = outPath(files[0], '.html');
  var html;
  try { html = FCD.toHTML(spec, { base: readBase(), preview: !!flags.preview }); }
  catch (e) { die(e.message); }
  fs.writeFileSync(out, html);
  console.error('  → ' + out + ' (' + Math.round(html.length / 1024) + 'KB)' + (flags.preview ? ' [미리보기 훅]' : ''));

  var c = FCD.check(html);
  var bad = c.lines.filter(function (l) { return !l.ok; });
  bad.forEach(function (l) { console.error('  ✗ 검수: ' + l.label + ' ← ' + l.why); });
  console.error('    검수 ' + (bad.length ? bad.length + '건 실패' : '통과') + ' — ' + c.info);
  console.error('    조작: Space 뒤집기 · ←→ 이동 · 1 알아요 · 2 몰라요 · S 셔플 · P 발표');
  process.exit(bad.length ? 1 : 0);
}

if (cmd === 'check') {
  var f = files[0];
  if (!f || !fs.existsSync(f)) die('산출물 파일이 없다.');
  var res = FCD.check(fs.readFileSync(f, 'utf8'));
  res.lines.forEach(function (l) {
    console.log((l.ok ? '  OK   ' : '  MISS ') + l.label + (l.ok ? '' : '   ← ' + l.why));
  });
  console.log('  INFO ' + res.info);
  process.exit(res.fail ? 1 : 0);
}

if (cmd === 'import') {
  var src = files[0];
  if (!src || !fs.existsSync(src)) die('가져올 파일이 없다.');
  var byExt = { '.csv': 'csv', '.tsv': 'tsv', '.txt': 'tsv', '.md': 'md' }[path.extname(src).toLowerCase()];
  var r = FCD.parseImport(fs.readFileSync(src, 'utf8'), { format: flags.format || byExt || 'auto' });
  r.warnings.forEach(function (w) { console.error('  ! ' + w); });
  if (!r.cards.length) process.exit(1);
  var slug = path.basename(src).replace(/\.[^.]+$/, '').replace(/[^\w가-힣-]+/g, '-').toLowerCase();
  var deck = {
    id: flags.id || 'flashcards-' + slug + '-v1',
    title: flags.title || path.basename(src).replace(/\.[^.]+$/, ''),
    subtitle: '',
    quiz: 'auto',
    accent: flags.accent || 'indigo',
    ratio: '8/5',
    cards: r.cards
  };
  var o = outPath(src, '.json');
  fs.writeFileSync(o, JSON.stringify(deck, null, 2) + '\n');
  console.error('  → ' + o + ' — ' + r.format + ' 로 읽어 카드 ' + r.cards.length + '장');
  report(FCD.validate(deck));
  process.exit(0);
}

if (cmd === 'csv') {
  var spec2 = readSpec(files[0]);
  var csv = FCD.toCsv(spec2);
  if (flags.out) { fs.writeFileSync(flags.out, csv); console.error('  → ' + flags.out); }
  else process.stdout.write(csv);
  process.exit(0);
}

if (cmd === 'new') {
  var dest = files[0];
  if (!dest) die('만들 파일 경로가 필요하다.');
  var stem = path.basename(dest).replace(/\.[^.]+$/, '');
  var fresh = {
    id: flags.id || 'flashcards-' + stem.toLowerCase() + '-v1',
    title: flags.title || stem,
    subtitle: '',
    story: false,
    quiz: 'auto',
    reverse: false,
    autoplaySec: 6,
    accent: flags.accent || 'indigo',
    ratio: '8/5',
    cards: [
      { id: 1, type: 'basic', category: '개념', front: '질문을 짧게', back: '답의 **핵심**만' },
      { id: 2, type: 'cloze', category: '개념', text: '문장 속 {{핵심어}} 를 빈칸으로 만든다' },
      { id: 3, type: 'sequence', category: '절차', front: '순서는?', items: ['첫 단계', '두 번째', '세 번째'] }
    ]
  };
  fs.writeFileSync(dest, JSON.stringify(fresh, null, 2) + '\n');
  console.error('  → ' + dest + ' — 카드 3장 뼈대. 내용을 바꾸고 `fc build` 한다');
  process.exit(0);
}

if (cmd === 'info') {
  var topic = files[0];
  function dump(name, obj, pick) {
    console.log('## ' + name);
    Object.keys(obj).forEach(function (k) {
      console.log('  ' + k.padEnd(11) + (pick ? pick(obj[k]) : obj[k]));
    });
    console.log('');
  }
  if (!topic || topic === 'types') {
    console.log('## 카드 형식 ' + Object.keys(FCD.CARD_TYPES).length + '종  (카드의 type)');
    Object.keys(FCD.CARD_TYPES).forEach(function (k) {
      var t = FCD.CARD_TYPES[k];
      console.log('  ' + k.padEnd(11) + t.label + ' — ' + t.use);
      console.log('  ' + ''.padEnd(11) + '필드: ' + t.fields.join(' · ') + '  (필수: ' + t.required.join(' · ') + ')');
    });
    console.log('  ' + ''.padEnd(11) + '공통: id(필수·정수) · category · context · note');
    console.log('');
  }
  if (!topic || topic === 'quiz') dump('퀴즈 모드 (루트 quiz)', FCD.QUIZ_MODES);
  if (!topic || topic === 'accents') dump('포인트색 프리셋 (루트 accent — #RRGGBB 도 된다)', FCD.ACCENTS, function (a) { return a.label + '  ' + a.hex; });
  if (!topic || topic === 'ratios') dump('카드 비율 (루트 ratio)', FCD.RATIOS);
  if (!topic) {
    console.log('## 그 외 루트 필드');
    console.log('  id          localStorage 키 (필수). 내용을 크게 바꾸면 -v2 로 올린다');
    console.log('  title       헤더·발표 타이틀 슬라이드');
    console.log('  subtitle    부제');
    console.log('  story       true 면 스토리라인 덱 — 셔플 기본 OFF + 섞을 때 경고 배지');
    console.log('  reverse     true 면 앞↔뒤 방향 전환 버튼 (외국어 단어장)');
    console.log('  autoplaySec 발표 자동재생 간격(초)');
    console.log('');
  }
  process.exit(0);
}

console.error('그런 명령은 없다: ' + cmd);
usage(1);

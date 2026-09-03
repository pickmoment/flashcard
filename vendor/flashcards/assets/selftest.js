/*!
 * selftest — deckcards 엔진 회귀 검사 (`node fc.js test`)
 *
 * 엔진이나 base.html 을 고쳤으면 이걸 통과시킨다. 검사하는 것은 세 가지다.
 *   1) 예제 덱이 전부 검증을 통과하고, 빌드한 산출물이 기계 검수를 통과한다
 *   2) base.html 의 교체 지점(CONFIG·DECK·색·비율·mermaid CDN)이 실제로 갈아끼워진다
 *   3) 스킬 문서(template.md §6)가 시키는 검증 경로가 계속 통한다
 */
'use strict';
var fs = require('fs'), path = require('path');
var FCD = require(path.join(__dirname, 'deckcards.js'));

var BASE = fs.readFileSync(path.join(__dirname, '..', 'references', 'base.html'), 'utf8');
var EX = path.join(__dirname, 'examples');
var pass = 0, fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '   ← ' + detail : '')); }
}

function eq(label, got, want) {
  ok(label + ' = ' + JSON.stringify(want), got === want, '실제 ' + JSON.stringify(got));
}

/* ---- 1. 예제 덱 ---- */
var examples = fs.readdirSync(EX).filter(function (f) { return /\.json$/.test(f); }).sort();
ok('예제가 있다', examples.length >= 4, examples.length + '개');

examples.forEach(function (f) {
  var spec = JSON.parse(fs.readFileSync(path.join(EX, f), 'utf8'));
  var v = FCD.validate(spec);
  ok(f + ' 검증 통과', v.ok, v.errors.join(' / '));

  var html = FCD.toHTML(spec, { base: BASE });
  var c = FCD.check(html);
  ok(f + ' 산출물 검수 통과', c.fail === 0,
    c.lines.filter(function (l) { return !l.ok; }).map(function (l) { return l.label; }).join(' / '));

  /* 두 번 빌드하면 같은 바이트여야 한다 — 앱과 CLI 결과가 어긋나지 않는 근거 */
  ok(f + ' 빌드가 결정적이다', html === FCD.toHTML(spec, { base: BASE }));

  /* 제목·색·비율이 실제로 들어갔는가 */
  var pal = FCD.palette(spec.accent);
  ok(f + ' 포인트색 주입', html.indexOf('--accent:' + pal.accent + ';') >= 0, pal.accent);
  ok(f + ' 다크 포인트색 주입', html.indexOf('--accent:' + pal.dark + ';') >= 0, pal.dark);
  ok(f + ' 카드 비율 주입', html.indexOf('aspect-ratio:' + (spec.ratio || '8/5') + ';') >= 0);

  /* mermaid CDN 은 카드가 있을 때만 */
  var needs = spec.cards.some(function (x) { return /```mermaid/.test(x.back || ''); });
  var cdn = /^<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@11/m.test(html);
  eq(f + ' mermaid CDN', cdn, needs);
  /* CDN 줄을 통째로 갈아끼우지 않고 문자열을 감싸면 `<!-- <!-- … --> -->` 가 되고,
     주석이 중첩되지 않는 HTML 에서는 바깥 닫는 표시가 본문 글자로 새어 나온다 */
  ok(f + ' 중첩 주석 없음', !/<!--\s*<!--/.test(html));
  eq(f + ' mermaid 줄이 하나뿐', (html.match(/mermaid@11/g) || []).length, 1);

  /* template.md §6 의 검증 경로 — 문서가 시키는 명령이 계속 통해야 한다 */
  var m = html.match(/const DECK = (\[[\s\S]*?\n\]);/);
  ok(f + ' DECK 정규식 추출', !!m);
  if (m) {
    var deck = JSON.parse(m[1]);
    eq(f + ' 카드 수', deck.length, spec.cards.length);
    var ids = deck.map(function (x) { return x.id; });
    ok(f + ' id 중복 없음', new Set(ids).size === ids.length);
  }
  ok(f + ' 제어문자 없음', !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(html));
});

/* ---- 2. 미리보기 훅 ---- */
var one = JSON.parse(fs.readFileSync(path.join(EX, 'starter-basic.json'), 'utf8'));
ok('일반 빌드에는 훅이 없다', FCD.toHTML(one, { base: BASE }).indexOf('window.FCP') < 0);
ok('preview 빌드에만 훅이 실린다', FCD.toHTML(one, { base: BASE, preview: true }).indexOf('window.FCP') > 0);

/* ---- 3. 검증이 실제로 잡는가 ---- */
function errsOf(spec) { return FCD.validate(spec).errors.join(' | '); }
function warnsOf(spec) { return FCD.validate(spec).warnings.join(' | '); }
var good = { id: 'flashcards-t-v1', title: 't', cards: [{ id: 1, front: 'a', back: 'b' }, { id: 2, front: 'c', back: 'd' }, { id: 3, front: 'e', back: 'f' }] };

ok('정상 덱은 오류 없음', FCD.validate(good).ok, errsOf(good));
ok('id 없으면 오류', /id 가 없다/.test(errsOf({ title: 't', cards: good.cards })));
ok('한글 id 는 통과', FCD.validate({ id: 'flashcards-새-덱-v1', title: 't', cards: good.cards }).ok);
ok('공백 있는 id 는 오류', /공백/.test(errsOf({ id: 'my deck', title: 't', cards: good.cards })));
ok('id 중복이면 오류', /중복/.test(errsOf({ id: 'x', title: 't', cards: [{ id: 1, front: 'a', back: 'b' }, { id: 1, front: 'c', back: 'd' }] })));
ok('back 없으면 오류', /back/.test(errsOf({ id: 'x', title: 't', cards: [{ id: 1, front: 'a' }] })));
ok('cloze 빈칸 없으면 오류', /빈칸이 없다/.test(errsOf({ id: 'x', title: 't', cards: [{ id: 1, type: 'cloze', text: '빈칸이 없는 문장' }] })));
ok('sequence 항목 부족하면 오류', /2개 이상/.test(errsOf({ id: 'x', title: 't', cards: [{ id: 1, type: 'sequence', front: 'q', items: ['하나'] }] })));
ok('모르는 quiz 값은 오류', /quiz 값/.test(errsOf({ id: 'x', title: 't', quiz: 'nope', cards: good.cards })));
ok('모르는 accent 는 오류', /accent/.test(errsOf({ id: 'x', title: 't', accent: 'noodle', cards: good.cards })));
ok('HEX accent 는 통과', FCD.validate({ id: 'x', title: 't', accent: '#123456', cards: good.cards }).ok);

ok('뒷면 4문장은 경고', /3문장을 넘으면/.test(warnsOf({
  id: 'x', title: 't', cards: [{ id: 1, front: 'q', back: '하나다. 둘이다. 셋이다. 넷이다.' }]
})));
ok('앞면에 답이 있으면 경고', /앞면에 답/.test(warnsOf({
  id: 'x', title: 't', cards: [{ id: 1, front: '렉시컬 스코프란 무엇인가', back: '렉시컬 스코프' }]
})));
ok('외부 이미지 경로는 경고', /단일 파일/.test(warnsOf({
  id: 'x', title: 't', cards: [{ id: 1, front: '![a](./x.png)', back: 'b' }]
})));
ok('스토리라인에 context 없으면 경고', /context/.test(warnsOf({
  id: 'x', title: 't', story: true, cards: good.cards
})));
ok('중복 개념(basic+cloze)은 경고', /중복 출제/.test(warnsOf({
  id: 'x', title: 't', cards: [{ id: 1, front: 'q', back: '렉시컬 스코프' }, { id: 2, type: 'cloze', text: '함수는 {{렉시컬 스코프}} 를 기억한다' }]
})));

/* ---- 4. 퀴즈 성립 판정이 base.html 과 같은가 ---- */
var small = { id: 'x', title: 't', cards: [{ id: 1, front: 'q1', back: 'a1' }, { id: 2, front: 'q2', back: 'a2' }] };
eq('오답이 1개면 주관식 폴백', FCD.stats(small).quiz.typing, 2);
eq('오답이 1개면 객관식 0', FCD.stats(small).quiz.choice, 0);
var big = { id: 'x', title: 't', cards: [1, 2, 3, 4].map(function (i) { return { id: i, front: 'q' + i, back: 'a' + i }; }) };
eq('오답이 넉넉하면 객관식', FCD.stats(big).quiz.choice, 4);
eq('sequence 는 출제 제외', FCD.stats({ id: 'x', title: 't', quiz: 'auto', cards: [{ id: 1, type: 'sequence', front: 'q', items: ['a', 'b'] }] }).quiz.total, 0);
eq('mermaid 답은 출제 제외', FCD.stats({ id: 'x', title: 't', cards: [{ id: 1, front: 'q', back: '```mermaid\nflowchart LR\n a-->b\n```' }] }).quiz.total, 0);
eq('quiz off 면 전부 제외', FCD.stats({ id: 'x', title: 't', quiz: 'off', cards: big.cards }).quiz.total, 0);

/* ---- 5. 가져오기 / 내보내기 ---- */
var csv = FCD.parseImport('front,back,category\n"콤마, 포함",답 1,개념\nq2,a2,문법\n', { format: 'csv' });
eq('csv 카드 수', csv.cards.length, 2);
eq('csv 인용부호 안 콤마', csv.cards[0].front, '콤마, 포함');
eq('csv 카테고리', csv.cards[1].category, '문법');

var tsv = FCD.parseImport('사과\tapple\n포도\tgrape\n', {});
eq('tsv 자동 판별', tsv.format, 'tsv');
eq('tsv 카드 수', tsv.cards.length, 2);

var mdIn = FCD.parseImport('- 클로저 :: 렉시컬 스코프를 기억하는 함수\n- 호이스팅 :: 선언이 위로 끌어올려지는 것\n', {});
eq('markdown 자동 판별', mdIn.format, 'md');
eq('markdown 카드 수', mdIn.cards.length, 2);
eq('markdown 앞면', mdIn.cards[0].front, '클로저');

var clozeIn = FCD.parseImport('HTTP {{200}} 은 성공이다\n', { format: 'md' });
eq('빈칸만 있으면 cloze', clozeIn.cards[0].type, 'cloze');

var seqIn = FCD.parseImport('배포 순서 :: 빌드 -> 테스트 -> 배포\n', { format: 'md' });
eq('화살표는 sequence', seqIn.cards[0].type, 'sequence');
eq('sequence 항목 수', seqIn.cards[0].items.length, 3);

var idStart = FCD.parseImport('a\tb\n', { startId: 10 });
eq('startId 이어붙이기', idStart.cards[0].id, 10);

var csvOut = FCD.toCsv(one).split('\n');
eq('csv 머리글', csvOut[0], 'id,type,category,front,back,items,note');
eq('csv 줄 수', csvOut.length, one.cards.length + 2);

/* ---- 6. 색 계산 ---- */
var pal = FCD.palette('indigo');
eq('프리셋 HEX', pal.accent, '#3b5bdb');
ok('tint 는 rgba', /^rgba\(/.test(pal.tint), pal.tint);
ok('다크 accent 가 더 밝다', FCD.contrast(FCD.palette('indigo').dark, [255, 255, 255]) < pal.contrastLight);
ok('잘못된 색은 null', FCD.palette('#12') === null);

/* 이 색으로 나오는 것이 답의 **굵게** 다 — 프리셋은 라이트·다크 양쪽에서 본문 기준선을 넘겨야 한다 */
Object.keys(FCD.ACCENTS).forEach(function (k) {
  var p = FCD.palette(k);
  ok('프리셋 ' + k + ' 흰 카드 대비 ' + p.contrastLight.toFixed(2) + ':1', p.contrastLight >= 4.5);
  ok('프리셋 ' + k + ' 다크 카드 대비 ' + p.contrastDark.toFixed(2) + ':1', p.contrastDark >= 4.5);
});

/* 그림이 질문인 카드는 alt·안내 문구가 겹치는 것이 정상이다 — 중복 출제로 오인하면 안 된다 */
var twoImages = {
  id: 'x', title: 't', cards: [
    { id: 1, front: '![도형 그림](data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E)\n\n이 도형의 이름은?', back: 'triangle' },
    { id: 2, front: '![도형 그림](data:image/svg+xml;utf8,%3Csvg%20/%3E)\n\n이 도형의 이름은?', back: 'cylinder' }
  ]
};
ok('이미지 카드는 중복 경고를 내지 않는다', !/앞면이 카드/.test(warnsOf(twoImages)), warnsOf(twoImages));

/* ---- 7. 정규화 ---- */
var normalized = FCD.normalize({ cards: [{ id: 1, type: 'cloze', text: 'a {{b}}', front: '버려질 값', items: ['x'] }] });
ok('형식과 맞지 않는 필드는 버린다', normalized.cards[0].front === undefined && normalized.cards[0].items === undefined);
eq('type 기본값', FCD.normalize({ cards: [{ id: 1, front: 'a', back: 'b' }] }).cards[0].type, 'basic');
eq('nextId', FCD.nextId([{ id: 3 }, { id: 7 }, { id: 1 }]), 8);
eq('blankCard sequence 항목', FCD.blankCard('sequence', 1).items.length, 2);

console.log('\n  ' + (fail ? '✗ ' + fail + '건 실패' : '✓ 전부 통과') + ' — 검사 ' + (pass + fail) + '개');
process.exit(fail ? 1 : 0);

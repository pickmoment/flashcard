# flashcards 커스터마이즈 가이드

**로직은 `references/base.html`에 이미 전부 구현되어 있다.** 이 문서는 그 파일을 어떻게 채우고
어디까지 고쳐도 되는지를 정한다. HTML/CSS/JS를 처음부터 쓰지 않는다 — 복사해서 데이터만 교체한다.

```bash
cp <스킬경로>/references/base.html <작업디렉토리>/flashcards-<주제-슬러그>.html
```

## 1. 반드시 고치는 것 — 파일 상단 "1. 설정 & 카드 데이터" 블록

이 블록 **하나만** 교체하면 새 덱이 된다. 그 아래 코드는 손대지 않는다.

```js
const CONFIG = {
  id: 'flashcards-<주제-슬러그>-v1', // localStorage 키. 내용을 크게 바꾸면 v2로 올린다
  title: '덱 제목',
  subtitle: '주제 한 줄 요약',        // 프레젠테이션 타이틀 슬라이드 부제로도 쓰인다
  story: false,        // 서사형 소스면 true — 셔플 기본 OFF + 셔플 시 경고 배지
  quiz: 'auto',        // 'off' | 'auto' | 'choice' | 'typing'
  reverse: false,      // 외국어 단어장 등 양방향 암기면 true
  autoplaySec: 6,
};
```

`quiz` 선택 기준:

| 값 | 언제 |
|---|---|
| `'auto'` (기본) | basic은 객관식, cloze는 빈칸 타이핑. 대부분 이걸 쓴다 |
| `'typing'` | 철자·정확한 표기가 목표 (영단어, 명령어, API 이름) — basic도 주관식으로 |
| `'off'` | 카드 학습만. 퀴즈 탭이 숨는다 |

`quiz: 'auto'`여도 **오답 보기를 2개 이상 못 만들면 그 카드는 자동으로 주관식으로 폴백**한다.
답이 코드블록·이미지뿐인 카드와 sequence·mermaid 카드는 출제에서 제외된다. 출제 가능한 카드가
0장이면 퀴즈 탭 자체가 숨는다 — 덱이 작으면(6장 미만) 퀴즈가 객관식이 아닐 수 있음을 사용자에게 알린다.

## 2. DECK 데이터 구조 (계약 — 필드명을 바꾸면 렌더가 깨진다)

```js
const DECK = [
  { id: 1,                     // 고유 번호(필수). localStorage 상태 매칭용 — 재사용/중복 금지
    type: 'basic',             // 'basic'(생략 가능) | 'cloze' | 'sequence'
    category: '개념',           // 카테고리 필터용. 2종 이상일 때만 칩·배지가 나온다
    front: '클로저란?',          // 앞면 (markdown)
    back: '**렉시컬 스코프**를 기억하는 함수.', // 뒷면 (markdown). ```mermaid 블록 가능
    note: '보충 한 줄',          // 선택. 뒷면 하단 작은 글씨
    context: null,             // 선택. 스토리라인 덱의 "지금까지: …" — 앞면 상단 작은 글씨
    choices: ['오답1','오답2'],  // 선택. 객관식 오답을 직접 지정 (없으면 다른 카드 back에서 자동 추출)
  },
  { id: 2, type: 'cloze',
    // front/back 대신 text 하나. {{정답}}이 빈칸이 된다 (여러 개 가능)
    text: '클로저는 {{렉시컬 스코프}}를 기억하며 {{GC}}되지 않는다.' },
  { id: 3, type: 'sequence',
    front: '이벤트 루프 순서는?',
    items: ['콜 스택 비움', '마이크로태스크 소진', '렌더링'] },  // 반드시 올바른 순서로 작성
];
```

- 카드 1장 = 개념 1개. 뒷면이 3문장을 넘으면 쪼갠다.
- `id`는 localStorage 키와 묶이므로 **한 번 배포한 뒤 id를 재배치하면 진행 상태가 엉킨다** — 카드를 추가할 땐 뒤에 새 번호를 붙이고, 대규모 개편은 `CONFIG.id`의 버전을 올린다.
- 스토리라인 덱: DECK을 이야기 순서로 배치 + 각 카드에 `context` + `CONFIG.story = true`.
- 같은 개념을 basic과 cloze로 중복 출제하지 않는다.

## 3. base.html이 이미 구현한 것 — 다시 만들지 않는다

| 영역 | 구현 상태 |
|---|---|
| markdown 미니 렌더러 | `md()` — 굵게·기울임·인라인 코드·코드블록·불릿/번호 목록·`---`·이미지. 헤딩/표/링크는 미지원(의도적) |
| cloze | `renderClozeFront/Back/Inputs()` — 학습·프레젠테이션·퀴즈 세 모드가 **공유**한다 |
| sequence | 앞면 시드 고정 셔플(카드 id 기반, 재방문 시 동일 배치) + 뒷면 번호 목록 |
| mermaid | 지연 렌더 + 캐시 + 측정용 probe에서 렌더 후 SVG 이식 + 실패 시 코드블록 폴백 |
| 카드 학습 | flip(3D/reduced-motion 크로스페이드), 이동, flip 전 분류 차단, 자동 다음 카드 |
| 오답 재순환 | 완료 화면 → "모르는 카드만 다시" → 오답 덱 재구성 → 전부 ✓면 축하 화면 |
| 완료 화면 | `conic-gradient` 원형 게이지 + ✓/✗ 카운트 |
| 퀴즈 | 객관식(길이 유사 오답 우선·중복 제거) / 주관식 / 빈칸 타이핑, 대소문자·공백 무시 채점, 틀린 문제 → 학습 "몰라요" 반영 |
| 프레젠테이션 | 타이틀 슬라이드 → 2단계 진행 → 자동재생 → Esc/fullscreenchange 종료, 학습 상태와 완전 독립. 공개 후 질문 영역은 24vh 고정 + 내부 스크롤, 답에 미디어가 있으면(`.has-media`) 질문을 상단에 붙이고 `presFitMedia()`가 답 미디어를 남은 높이에 px로 맞춘다 |
| 제자리 확대 | `zoomToggle()` — 이미지·mermaid svg 클릭 시 오버레이 없이 그 자리에서 1.8×→3×→원래 크기 순환. 담고 있는 영역에 `.zoom-scroll`을 붙여 스크롤 컨테이너로 만들고(플렉스 센터링은 `display:block`으로 해제해 위쪽까지 스크롤 가능), document 캡처 단계 리스너로 flip·발표 진행 전파를 차단한다. 카드 전환·flip 시 `zoomReset()` |
| 키보드 | Space/Enter, ←→, 1, 2, S, P / 발표 중 Space·←·A·Esc / 확대 중 0·Esc(원래 크기). 확대 → 발표 순서로 핸들러 최상단에서 검사 |
| 저장 | localStorage에 known/lastIndex/shuffled/reverse/cat |
| 그 외 | 카테고리 칩(카드 수 표기), 셔플, 양방향, 터치 스와이프, 다크 모드, 한국어 `keep-all` |

## 4. 필요할 때만 손대는 곳

- **mermaid CDN**: `<head>`의 주석 처리된 `<script src="…mermaid@11…">` 한 줄. 덱에 mermaid 카드가 **있을 때만** 주석을 해제한다. 없으면 그대로 둔다(코드블록으로 폴백되므로 깨지지 않는다).
- **색**: `:root`의 `--accent` / `--accent-lite` / `--accent-tint` 세 값만 주제에 맞게 바꾼다. 세 값을 같은 색조로 유지해야 진행 바 그라디언트와 배지 tint가 어긋나지 않는다. 다크 모드 블록의 `--accent`도 같이 바꾼다(밝은 변형으로).
- **카드 비율**: `.card`의 `aspect-ratio: 8/5`. 답이 긴 덱이면 `7/5` 정도로. `max-height: calc(100dvh - 330px)`는 알아요/몰라요 버튼이 접히지 않게 계산된 값이므로 건드리지 않는다.
- **자동재생 간격**: `CONFIG.autoplaySec`.
- **발표 앞면 질문 크기**: `.p-front`(기본) / `.p-front.len-m`(41~90자) / `.p-front.len-l`(90자 초과) 3단계. 단계는 `presPaint()`가 질문 글자수로 자동 부여한다. 강의실이 크면 세 값의 `clamp` 상한을 함께 올린다 — 공개 후 크기는 `.present.revealed .p-front` 한 줄에서 3단계를 모두 덮으므로 따로 손댈 필요가 없다.

## 5. 구조를 바꾸면 안 되는 이유 (실제 발생한 사고)

- **md()에 원시 HTML을 선주입하지 않는다.** `md()`는 입력 전체를 이스케이프하므로 `<span>`을 미리 끼워 넣으면 화면에 `&lt;span…`이 텍스트로 노출된다. HTML을 섞어야 하면 반드시 base.html의 "ASCII 토큰 삽입 → md() → 토큰을 HTML로 치환" 왕복 패턴을 쓴다.
- **플레이스홀더에 제어 문자를 쓰지 않는다.** 리터럴 NUL 등이 파일에 들어가면 HTML 파서가 U+FFFD로 치환해 스크립트 전체가 죽고 `file` 명령이 binary로 판정한다. base.html은 `@@CB0@@` / `@@BLANK0@@` 같은 순수 ASCII 토큰만 쓴다.
- **cloze 렌더 함수를 모드별로 복제하지 않는다.** 학습·프레젠테이션·퀴즈가 각자 구현하면 같은 버그가 세 곳에서 재발한다.
- **키보드 핸들러 최상단의 `if (pres.on)` 조기 return을 지우지 않는다.** 발표 중 Space가 학습 모드 flip과 동시 발화한다.
- **`fullscreenchange` 리스너를 지우지 않는다.** 풀스크린 중 Esc는 keydown이 안 잡히는 브라우저가 있어 이 경로가 유일한 종료 수단이 된다.

## 6. 생성 후 검증 (필수)

```bash
# 1) 제어문자 오염 — "HTML document text"가 아니면 실패
file <산출물>.html
# 2) 스크립트 문법
node -e "const fs=require('fs');const m=fs.readFileSync('<산출물>.html','utf8').match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync('/tmp/fc.js',m[1])" && node --check /tmp/fc.js
# 3) DECK 데이터 정합성 — id 중복, 형식별 필수 필드 누락
node -e "
const fs=require('fs');const s=fs.readFileSync('<산출물>.html','utf8');
const deck=eval(s.match(/const DECK = (\[[\s\S]*?\n\]);/)[1]);
const ids=deck.map(c=>c.id);
if(new Set(ids).size!==ids.length) throw 'id 중복';
deck.forEach(c=>{
  if(c.type==='cloze'){ if(!c.text||!/\{\{.+?\}\}/.test(c.text)) throw 'cloze '+c.id+': text/{{}} 누락'; }
  else if(c.type==='sequence'){ if(!c.front||!(c.items||[]).length) throw 'sequence '+c.id+': front/items 누락'; }
  else if(!c.front||!c.back) throw 'basic '+c.id+': front/back 누락';
});
console.log('DECK OK — '+deck.length+'장');
"
```

base.html의 로직은 브라우저에서 검증 완료된 상태다. DECK만 교체했다면 위 3개로 충분하다.
**렌더 함수를 수정했다면** 브라우저로 열어 cloze 앞면에 `<span class="blank">`가 태그로 들어갔는지,
정답 텍스트가 앞면에 노출되지 않는지 직접 확인한다.

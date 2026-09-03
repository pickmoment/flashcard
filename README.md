# flashcard

플래시카드 덱 에디터. Tauri 2 (Rust) + React + TypeScript.

덱 스펙(JSON)을 폼으로 편집하고, **실제 산출물 HTML** 을 그 자리에서 미리 보고,
단일 HTML · CSV · 덱 스펙으로 내보낸다. 앱 안에 `flashcards` 스킬 전체가 들어 있어
`~/.claude/skills/flashcards` 설치도 이 앱이 한다.

엔진은 Claude Code 의 `flashcards` 스킬에서 갈라져 나왔다. 이 저장소가 그 사본을 들고 있고,
로컬 수정은 `vendor/PATCHES.md` 에 적혀 있다. 자매 프로젝트는 모션그래픽 쪽의 `gmotion` 이다.

## 왜 이런 구조인가

**렌더 로직을 다시 쓰지 않는다.** flip · 퀴즈 3종 · 프레젠테이션 · 제자리 확대 · cloze ·
mermaid · localStorage 진행 저장은 전부 스킬의 `references/base.html` 이 이미 갖고 있다.
엔진(`assets/deckcards.js`)이 하는 일은 그 파일의 **교체 가능한 자리 다섯 곳**을 갈아끼우는
것뿐이다 — `CONFIG`·`DECK` 블록, `<title>`, 포인트색 3값 × 2모드, 카드 `aspect-ratio`,
mermaid CDN 주석. 그래서 산출물은 스킬이 손으로 만드는 것과 같은 파일이고, 앱은 그 파일을
만드는 도구일 뿐이다.

**엔진은 앱이 직접 들고 있다.** `vendor/flashcards/` 가 스킬 디렉토리의 사본이고,
런타임에 사용자의 `~/.claude/skills` 를 읽지 않는다. 스킬이 설치돼 있지 않아도 앱은 완전히
동작하고, 오히려 앱이 스킬을 설치하는 쪽이다.

**엔진은 브라우저에서 돈다.** `deckcards.js` 는 UMD 라 Node 없이 웹뷰에서 그대로 실행된다.
Node 전용 부분은 `base.html` 을 디스크에서 읽는 것뿐이고, `toHTML(spec, { base })` 로 소스를
주입하면 우회된다 — 사이드카가 없다.

**산출물은 CLI 와 동일하다.** 같은 스펙을 CLI(`fc build`)로 빌드한 결과와 앱(브라우저 엔진)이
빌드한 결과가 **SHA-256 까지 일치한다**(실측: `starter-basic` 61,178자 →
`1e5f31411bd72975f6510fac09007a14eeaa33e10e9fcd7802809343da9a2fff`, 양쪽 동일).
미리보기도 별도 렌더러가 아니라 그 산출물 HTML 을 iframe 에 그대로 띄운 것이다 —
**미리보기 · 내보낸 파일 · CLI 산출물이 전부 같은 그림이다.**

```
vendor/flashcards/       스킬 전체 (소스 오브 트루스, 하나뿐)
  ├─ 프론트엔드가 ?raw 로 읽어 엔진을 부팅         → src/engine/boot.ts
  └─ Rust 가 include_dir! 로 바이너리에 넣어 설치  → src-tauri/src/skill.rs
```

## 구성

```
vendor/flashcards/
  SKILL.md                     스킬 본문 (§5-b 에 CLI 절을 더했다)
  references/base.html         산출물 골격 — 렌더·퀴즈·발표 로직 전부
  references/template.md       DECK 필드 계약 · 손대면 안 되는 부분
  assets/deckcards.js          엔진 — 검증 · 빌드 · 기계 검수 · 가져오기/내보내기 (UMD)
  assets/fc.js                 CLI — new · validate · build · check · import · csv · info · test
  assets/selftest.js           엔진 회귀 검사 (114개)
  assets/examples/*.json       스타터 덱 4종
src/
  engine/
    boot.ts        vendor 엔진을 브라우저에서 부팅 (CommonJS 셰임) · base.html · 예제 · 문서
    types.ts       엔진 공개 표면과 덱 스펙 타입
    schema.ts      카드 형식별 편집 스키마 — 폼을 그리는 선언
  lib/
    build.ts       validate · toHTML · check (base.html 주입을 빠뜨리지 않게 한곳에)
    deck.ts        덱 불변 조작 — id 는 재사용하지 않는다
    cardChange.ts  카드 형식 바꾸기 — 내용을 역할이 같은 자리로 옮기고 버린 것을 알린다
    useDeckStore.ts 실행 취소 / 다시 실행
    tauri.ts       Rust 커맨드 · 다이얼로그 · 브라우저 폴백
  components/
    Toolbar        파일 · 실행 취소 · 내보내기
    CardList       카드 목록 (카테고리 칩 · 이동 · 복제 · 삭제 · 형식별 추가)
    CardForm       형식별 폼 + fields/ (markdown 툴바 · cloze · 순서 · 객관식 오답)
    DeckSettings   루트 필드 (제목 · id · 퀴즈 모드 · 스토리라인 · 양방향 · 색 · 비율 · 통계)
    Preview        산출물 iframe + 트랜스포트 (뒤집기 · 퀴즈 · 발표 · 진행 초기화 · 새 창)
    ValidatePanel  오류 · 경고 — 경고 줄을 누르면 그 카드로 간다
    CheckPanel     산출물 기계 검수
    ImportPanel    csv · tsv · md · anki → 카드
    ExamplesPanel · DocsPanel · SkillPanel · JsonEditor · ErrorBoundary
src-tauri/
  src/skill.rs     번들 스킬 페이로드 — 상태 비교 · 설치 · 제거
  src/lib.rs       파일 I/O · 이미지 data URI · 파일 열기 · 커맨드 등록
```

## 기능

|                 |                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 카드 편집       | 형식 3종(기본 · 빈칸 채우기 · 순서 배열)을 폼으로. 빈 값은 키째 지워 스펙을 깨끗하게 유지하고, 필수 필드만 빈 문자열로 남겨 검증이 "없다" 고 말하게 한다                |
| 형식 바꾸기     | 내용이 **역할이 같은 자리로 따라간다**(질문 · 답 · 단계 · 빈칸). 자리가 없는 것만 버리고 무엇을 버렸는지 알린다                                                        |
| markdown        | 굵게 · 코드 · 코드블록 · 목록 · 이미지 · mermaid 삽입 도구. `base.html` 의 `md()` 가 실제로 해석하는 문법만 넣는다 — 헤딩 · 표 · 링크 버튼은 일부러 없다               |
| 이미지 카드     | 고른 그림을 data URI 로 심는다(네이티브는 Rust, 브라우저는 FileReader) — 단일 파일이 유지된다                                                                          |
| 미리보기        | 실제 산출물을 iframe 에. 편집 중인 카드로 자동 이동하고, 뒤집기 · 퀴즈 탭 · 발표 모드 · 진행 초기화를 산출물의 훅(`window.FCP`)으로만 조작한다                        |
| 검증            | `fc validate` 와 같은 오류(✗) · 경고(!). 경고는 학습 설계에 대한 지적이라 숨기지 않는다 — 뒷면 3문장 초과, 앞면에 답 노출, 중복 출제, 퀴즈 폴백, 포인트색 대비 부족 등 |
| 검수            | 산출물 기계 검수 — 제어문자 오염, 이스케이프된 빈칸 태그, 중첩 주석, mermaid CDN 정합, 스크립트 문법, `keep-all`, 감소 모션, aria 라벨                                 |
| 퀴즈 예고       | 카드마다 객관식 · 주관식 · 빈칸 · 제외를 미리 보여준다. 판정은 `base.html` 의 `quizMode()` 를 그대로 옮겼으므로 산출물과 어긋나지 않는다                              |
| 가져오기        | csv · tsv · md · anki. `{{ }}` 만 있으면 빈칸 카드, `->` · `→` 로 이어지면 순서 카드로 읽는다. 이어붙인 뒤 전체 id 를 다시 매긴다                                      |
| 내보내기        | 단일 HTML · CSV · 덱 스펙 JSON. 검증 오류가 있으면 HTML 내보내기를 막는다                                                                                              |
| 스킬 설치       | `~/.claude/skills` · `~/.agents/skills` · 프로젝트 폴더. 파일 단위로 없는 것 · 다른 것 · 번들에 없는 것을 표시한다                                                     |
| 문서            | 번들 안의 SKILL.md · template.md 를 앱에서 읽는다(줄 단위 검색)                                                                                                        |
| 브라우저 폴백   | 네이티브 없이 `npm run dev` 로 띄워도 동작한다 — 파일 열기·저장은 업로드/다운로드로, 스킬 설치는 잠긴다. 화면 검수를 브라우저에서 하기 위한 길이다                     |

단축키: `⌘S`/`Ctrl+S` 저장 · `⌘O`/`Ctrl+O` 열기 · `⌘Z` 실행 취소 · `⇧⌘Z`/`Ctrl+Y` 다시 실행

## 미리보기가 `srcdoc` 인 이유

산출물은 카드별 ✓/✗ 와 마지막 위치를 `localStorage` 에 저장하고, 앱은 `contentWindow.FCP` 로
그 문서를 조작한다. 둘 다 **같은 출처**여야 한다.

- `blob:` URL 로 프레임을 내비게이션하면 요즘 Chromium 은 그 문서에 불투명 출처를 준다 —
  실측: `contentDocument` 가 `null`, `FCP` 접근은 `SecurityError`.
- `srcdoc` 문서는 부모 출처를 물려받아 저장도 훅도 실제로 돈다. `sandbox` 를 붙이면 다시
  불투명해지므로 붙이지 않고, 대신 `allow="fullscreen"` 만 열어 발표 모드가 미리보기에서도
  풀스크린으로 뜨게 한다.
- blob URL 은 "새 창" 버튼에만 쓴다 — 그 창은 우리가 들여다볼 필요가 없는 최상위 문서다.

**CSP 는 두 줄이 함께 있어야 한다**(`tauri.conf.json` 의 `app.security`) —
`script-src` 에 `'unsafe-inline'`, 그리고 `"dangerousDisableAssetCspModification": ["script-src"]`.
srcdoc 문서는 부모의 CSP 를 물려받고 산출물의 런타임은 인라인 `<script>` 이므로, 인라인이
막히면 그림만 서고 움직이지 않는다. `'unsafe-inline'` 만으로는 부족하다: Tauri 가 자기
인라인 스크립트의 `'sha256-…'` 을 `script-src` 에 덧붙이는데, CSP 규칙상 해시·nonce 가
하나라도 있으면 `'unsafe-inline'` 은 무시된다. 근거는 `src-tauri/src/lib.rs` 의 `run()` 위
주석에 적혀 있다(JSON 에는 주석을 쓸 수 없다). `cdn.jsdelivr.net` 을 허용하는 이유는 산출물이
Pretendard 폰트와 mermaid 를 CDN 에서 받기 때문이다 — 미리보기가 실제 산출물과 같아야 한다.

**dev 에서는 CSP 증상이 안 보인다** — 창이 vite(`devUrl`)를 열어 Tauri 가 CSP 를 싣지 않기
때문이다. CSP 를 건드렸으면 `npm run tauri build` 로 만든 번들에서 미리보기가 도는지 확인한다.

## 개발

필요한 것: Node 20+ · Rust 1.8x+ · C++ 빌드 도구 (macOS: Xcode CLT, Windows: VS Build Tools).
외부 서비스나 API 키는 쓰지 않는다.

```bash
npm install
npm run tauri dev          # 앱 실행
npm run tauri build        # 배포 번들

npm run dev                # 브라우저 모드 (파일 기능은 업로드/다운로드로 내려앉는다)
npx tsc --noEmit           # 타입 검사
npm test                   # deck · cardChange 단위 테스트 (36개)
npm run lint
cd src-tauri && cargo test # base64 왕복 · 이미지 mime · 스킬 설치 왕복 (7개)

node vendor/flashcards/assets/fc.js test   # 엔진 회귀 검사 (114개)
```

vendor 엔진은 CLI 로도 그대로 쓸 수 있다. `vendor/package.json` 이 루트의 `type: module` 로부터
CommonJS 를 격리해 둔다 (스킬 페이로드에는 들어가지 않는다).

```bash
node vendor/flashcards/assets/fc.js info types
node vendor/flashcards/assets/fc.js build deck.json -o flashcards-주제.html
node vendor/flashcards/assets/fc.js import 단어장.csv -o deck.json
```

## 엔진 갱신

`vendor/flashcards/` 를 새 스킬로 갈아끼우면 프론트엔드 · Rust 양쪽이 같이 따라온다.
`vendor/package.json` 은 지우지 않는다.

**갈아끼우기 전에 `vendor/PATCHES.md` 를 읽는다.** 업스트림에 없는 로컬 수정(`assets/` 전체,
base.html 의 aria 라벨, SKILL.md 의 CLI 절)이 적혀 있고, 다시 vendoring 하면 사라진다.
갈아끼운 뒤에는 `node vendor/flashcards/assets/fc.js test` 와 `cargo test` 를 통과시킨다.
`base.html` 의 교체 지점이 바뀌면 `toHTML` 이 **명확한 오류로 멈춘다** — 조용히 잘못된
산출물을 내지 않으므로, 그때 고칠 곳은 `deckcards.js` 의 `ANCHORS` 하나다.

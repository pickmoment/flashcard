# vendor/flashcards 로컬 수정

`vendor/flashcards/` 는 Claude Code 의 `flashcards` 스킬 사본이다. 아래는 **업스트림 스킬에 없는
로컬 수정**이고, 스킬을 다시 vendoring 하면 사라진다. 갈아끼우기 전에 이 문서를 읽는다.

갈아끼운 뒤에 통과시킬 것: `node vendor/flashcards/assets/fc.js test` · `cd src-tauri && cargo test`.

---

## 1. `assets/` 전체가 로컬 추가다

업스트림 스킬은 **base.html 을 복사해 손으로 `CONFIG`·`DECK` 을 고치는** 절차만 갖고 있다.
그 절차는 사람이 한 번 만들 때는 맞지만, 앱이 폼으로 편집하려면 "스펙 → 산출물" 변환이
코드로 있어야 한다. 그래서 다음을 새로 만들어 넣었다.

| 파일 | 무엇 |
| --- | --- |
| `assets/deckcards.js` | 엔진. 덱 스펙(JSON) → 단일 HTML, 검증, 기계 검수, 가져오기/내보내기. UMD 라 Node·브라우저 공용 |
| `assets/fc.js` | CLI — `new` · `validate` · `build` · `check` · `import` · `csv` · `info` · `test` |
| `assets/selftest.js` | 엔진 회귀 검사 (`fc test`). 예제 4종을 빌드해 산출물까지 검사한다 |
| `assets/examples/*.json` | 스타터 덱 4종 |

**엔진은 base.html 의 로직을 복제하지 않는다.** 렌더·flip·퀴즈·프레젠테이션·확대는 전부
base.html 이 하고, 엔진은 교체 가능한 자리만 갈아끼운다:

- `const CONFIG = { … };` ~ `const DECK = [ … ];` 블록 (템플릿의 "1. 설정 & 카드 데이터")
- `<title>`
- `:root` 와 `prefers-color-scheme: dark` 의 `--accent` / `--accent-lite` / `--accent-tint`
- `.card` 의 `aspect-ratio`
- mermaid CDN `<script>` 주석 해제 여부

이 다섯 자리의 **문자열 앵커가 곧 계약**이다(`deckcards.js` 의 `ANCHORS`). base.html 을 새 버전으로
갈아끼우면서 이 자리들의 모양이 바뀌면 `toHTML` 이 명확한 오류로 멈춘다 — 조용히 잘못된 산출물을
내지 않는다. 그때 고칠 곳은 `ANCHORS` 하나다.

`plain()` · `clozeAnswers()` · `hasMermaid()` · `quizMode()` 는 base.html 에서 **그대로 옮겨온
복제**다. 검증이 산출물과 다른 눈으로 보면 "객관식으로 나올 줄 알았는데 주관식이었다" 같은
거짓말을 하게 된다. base.html 의 그 함수들을 고쳤으면 엔진의 사본도 같이 고친다 —
`selftest.js` 의 "퀴즈 성립 판정" 절이 어긋남을 잡는다.

## 2. `references/base.html` — 조작부에 `aria-label` 을 붙였다

업스트림 base.html 에는 `aria-*` 속성이 하나도 없었다. 마크업만 손댔고 **JS·CSS 는 건드리지 않았다**.

- 탭 `nav` 에 `aria-label`, 두 탭 버튼에 각각 `aria-label`
- 툴 버튼 4개(발표·셔플·방향·초기화)에 `aria-label`
- 카드 `div#card` 에 `aria-label`
- 이동·분류 버튼 4개(이전·몰라요·알아요·다음)에 `aria-label`
- 진행 표시 `.pmeta` 에 `role="status" aria-live="polite"` — 이 영역은 `textContent` 로 갱신되므로
  실제로 읽어 줄 값이 바뀐다. 진행 바(`.bar i`)에는 `role="progressbar"` 를 **넣지 않았다**:
  `aria-valuenow` 를 갱신하는 코드가 없어 거짓 값을 읽어 주게 된다.

이 수정에 기대는 것이 있다 — `fc check` 의 "스크린리더 라벨" 항목이 `aria-label=` 을 요구한다.
라벨을 지우면 산출물이 검수에서 떨어진다.

## 3. `SKILL.md` — "5-b. 손으로 복사하지 않는 길 — `fc` CLI" 절과 참고 파일 4줄

스킬을 읽는 에이전트가 `assets/` 의 존재를 모르면 여전히 base.html 을 손으로 복사한다.
CLI 사용법·덱 스펙 모양·`fc test` 를 §5-b 로 넣고, §6 표에 `assets/*` 4줄을 더했다.
업스트림 §0~§4(카드 추출 원칙·형식 선택·모드·디자인 규칙)는 **그대로 두었다** — 그 판단 기준은
CLI 가 있어도 사람이 하는 일이고, 엔진의 경고 문구가 바로 그 기준을 인용한다.

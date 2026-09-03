/**
 * 번들된 flashcards 엔진을 브라우저에서 부팅한다.
 *
 * `deckcards.js` 는 UMD 라 Node 없이 웹뷰에서 그대로 돈다. Node 전용 부분은
 * `references/base.html` 을 디스크에서 읽는 것뿐이고, `?raw` 로 문자열을 들고 와
 * `toHTML(spec, { base })` 에 넘기면 우회된다 — 사이드카가 없다.
 *
 * 소스 오브 트루스는 `vendor/flashcards/` 하나다. Rust 는 같은 디렉토리를
 * `include_dir!` 로 바이너리에 넣어 스킬 설치에 쓴다.
 */
import engineSrc from "../../vendor/flashcards/assets/deckcards.js?raw";
import baseSrc from "../../vendor/flashcards/references/base.html?raw";
import skillDoc from "../../vendor/flashcards/SKILL.md?raw";
import templateDoc from "../../vendor/flashcards/references/template.md?raw";

import exBasic from "../../vendor/flashcards/assets/examples/starter-basic.json";
import exMixed from "../../vendor/flashcards/assets/examples/starter-mixed.json";
import exStory from "../../vendor/flashcards/assets/examples/starter-story.json";
import exVocab from "../../vendor/flashcards/assets/examples/starter-vocab.json";

import type { Deck, Engine } from "./types";

/** boot 은 절대 던지지 않는다 — 흰 화면 대신 부팅 실패를 기록한다. */
export let bootError: Error | null = null;

/**
 * UMD 소스를 CommonJS 셰임 안에서 평가한다. `module.exports` 만 돌려받고
 * 전역은 건드리지 않으므로, 엔진이 앱의 전역과 섞이지 않는다.
 */
function evalUMD(src: string, name: string): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  const fn = new Function("module", "exports", "self", src + `\n//# sourceURL=${name}`);
  fn(module, module.exports, {});
  return module.exports;
}

/** 엔진. 앱 전체가 이 하나만 쓴다. */
export let FCD = {} as Engine;
try {
  FCD = evalUMD(engineSrc, "deckcards.js") as unknown as Engine;
} catch (e) {
  bootError = e as Error;
}

/** 산출물의 골격. `toHTML` 에 항상 이걸 넘긴다. */
export const BASE_HTML = baseSrc;

/** 앱 안에서 읽는 스킬 문서. */
export const DOCS: { key: string; title: string; body: string }[] = [
  { key: "skill", title: "SKILL.md — 스킬 본문", body: skillDoc },
  { key: "template", title: "template.md — 커스터마이즈 계약", body: templateDoc },
];

/** 번들된 예제 덱. 백지에서 시작하지 않는다. */
export const EXAMPLES: { key: string; deck: Deck; note: string }[] = [
  {
    key: "starter-basic",
    deck: exBasic as Deck,
    note: "정의·개념 12장 — basic 만 쓴 표준 덱. 카테고리 4종",
  },
  {
    key: "starter-mixed",
    deck: exMixed as Deck,
    note: "형식 세 가지 + mermaid 다이어그램을 한 덱에 섞은 예",
  },
  {
    key: "starter-story",
    deck: exStory as Deck,
    note: "스토리라인 덱 — context 로 이야기를 잇고 셔플을 끈다",
  },
  {
    key: "starter-vocab",
    deck: exVocab as Deck,
    note: "양방향 + 주관식 타이핑 단어장. 그림 보고 답하기 이미지 카드 포함",
  },
];

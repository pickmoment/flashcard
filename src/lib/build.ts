/**
 * 엔진 호출을 한곳에 모은다 — base.html 주입을 빠뜨리지 않게.
 *
 * CLI(`fc build`)와 앱이 **같은 함수**를 부르므로 두 경로의 산출물이 어긋날 수 없다
 * (엔진의 selftest 가 그 결정성을 검사한다).
 */
import { BASE_HTML, FCD } from "../engine/boot";
import type { CheckResult, Deck, ValidateResult } from "../engine/types";

export function validate(deck: Deck): ValidateResult {
  try {
    return FCD.validate(deck);
  } catch (e) {
    return {
      ok: false,
      errors: [`엔진 오류: ${(e as Error).message}`],
      warnings: [],
      stats: FCD.stats({ cards: [] }),
      cards: [],
    };
  }
}

/** 산출물 HTML. `preview` 를 켜면 미리보기 훅(window.FCP)이 함께 실린다. */
export function build(deck: Deck, opts: { preview?: boolean } = {}): string {
  return FCD.toHTML(deck, { base: BASE_HTML, preview: !!opts.preview });
}

export function check(html: string): CheckResult {
  return FCD.check(html);
}

/** 저장 파일명 — 스펙 id 를 잇는다. `flashcards-git-v1` → `flashcards-git-v1.html` */
export function suggestName(deck: Deck, ext: string): string {
  const stem = (deck.id || deck.title || "flashcards").replace(/[^\w가-힣.-]+/g, "-");
  return `${stem}${ext}`;
}

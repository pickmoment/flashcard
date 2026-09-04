/**
 * 덱 조작 — 전부 순수 함수다. 입력을 변형하지 않고 새 객체를 돌려준다.
 *
 * React 상태로 그대로 쓰이므로 참조가 바뀌는 것이 곧 "달라졌다" 는 신호다.
 * 바뀐 곳만 새 배열·새 객체로 갈고 나머지는 참조를 잇는다(깊은 복사를 하지 않는다).
 *
 * 카드 id 는 **절대 재사용하지 않는다** — 산출물의 진행 상태가 localStorage 에
 * id 로 저장되므로, 지운 카드의 번호를 새 카드가 물려받으면 남의 학습 기록을
 * 그대로 뒤집어쓴다. `FCD.nextId` 가 항상 최대값+1 을 주는 이유다.
 */
import { FCD } from "../engine/boot";
import type { Card, CardType, Deck } from "../engine/types";

/** 새 덱. id 는 그대로 두면 검증이 잡는다 — 주제에 맞게 바꾸라는 뜻이다. */
export function emptyDeck(): Deck {
  return {
    id: "flashcards-새-덱-v1",
    title: "새 덱",
    quiz: "auto",
    accent: "indigo",
    ratio: "8/5",
    cards: [FCD.blankCard("basic", 1)],
  };
}

/** 같은 id 카드를 교체한다. 없는 카드면 아무 일도 없다(참조 그대로). */
export function withCard(deck: Deck, card: Card): Deck {
  const i = deck.cards.findIndex((c) => c.id === card.id);
  if (i < 0) return deck;
  const cards = deck.cards.slice();
  cards[i] = FCD.orderKeys(card);
  return { ...deck, cards };
}

/** `afterId` 바로 뒤에 새 카드를 끼운다. 없으면 맨 뒤. */
export function addCard(deck: Deck, type: CardType, afterId?: number): { deck: Deck; id: number } {
  const id = FCD.nextId(deck.cards);
  const cards = deck.cards.slice();
  const at = afterId == null ? -1 : cards.findIndex((c) => c.id === afterId);
  cards.splice(at < 0 ? cards.length : at + 1, 0, FCD.orderKeys(FCD.blankCard(type, id)));
  return { deck: { ...deck, cards }, id };
}

export function removeCard(deck: Deck, id: number): Deck {
  const cards = deck.cards.filter((c) => c.id !== id);
  return cards.length === deck.cards.length ? deck : { ...deck, cards };
}

/** 원본 바로 뒤에 사본을 놓는다. 내용은 전부 잇고 id 만 새로 받는다. */
export function duplicateCard(deck: Deck, id: number): { deck: Deck; id: number } {
  const i = deck.cards.findIndex((c) => c.id === id);
  if (i < 0) return { deck, id };
  const next = FCD.nextId(deck.cards);
  const copy = FCD.orderKeys(FCD.normalizeCard({ ...deck.cards[i], id: next }));
  const cards = deck.cards.slice();
  cards.splice(i + 1, 0, copy);
  return { deck: { ...deck, cards }, id: next };
}

/** `delta` 칸 옮긴다. 끝을 넘어가면 그대로 둔다 — 순환하면 목록이 튄다. */
export function moveCard(deck: Deck, id: number, delta: number): Deck {
  const i = deck.cards.findIndex((c) => c.id === id);
  if (i < 0 || !delta) return deck;
  const to = i + delta;
  if (to < 0 || to >= deck.cards.length) return deck;
  const cards = deck.cards.slice();
  const [moved] = cards.splice(i, 1);
  cards.splice(to, 0, moved);
  return { ...deck, cards };
}

/**
 * 덱 순서 기준 `toIndex` 로 옮긴다(드래그 놓기). 범위 밖은 끝으로 붙인다 —
 * 목록 맨 아래 빈 공간에 놓는 손짓이 "맨 뒤로" 라는 뜻이기 때문이다.
 */
export function moveCardTo(deck: Deck, id: number, toIndex: number): Deck {
  const i = deck.cards.findIndex((c) => c.id === id);
  if (i < 0) return deck;
  const to = Math.max(0, Math.min(deck.cards.length - 1, Math.trunc(toIndex)));
  if (to === i) return deck;
  const cards = deck.cards.slice();
  const [moved] = cards.splice(i, 1);
  cards.splice(to, 0, moved);
  return { ...deck, cards };
}

/** 여러 장을 한 번에 지운다. 없는 id 는 무시하고, 하나도 안 지웠으면 참조 그대로. */
export function removeCards(deck: Deck, ids: number[]): Deck {
  const drop = new Set(ids);
  const cards = deck.cards.filter((c) => !drop.has(c.id));
  return cards.length === deck.cards.length ? deck : { ...deck, cards };
}

/**
 * 고른 카드들의 카테고리를 한 값으로 맞춘다. '' 이면 키째 지운다 —
 * `"category": ""` 는 칩에 빈 이름으로 서므로 저장 JSON 에 남기지 않는다.
 * 이미 같은 값인 카드는 건드리지 않아 바뀐 장만 새 객체가 된다.
 */
export function setCategory(deck: Deck, ids: number[], category: string): Deck {
  const want = new Set(ids);
  const value = category.trim();
  let changed = false;
  const cards = deck.cards.map((c) => {
    if (!want.has(c.id) || (c.category ?? "") === value) return c;
    changed = true;
    return recategorize(c, value);
  });
  return changed ? { ...deck, cards } : deck;
}

/** `from` 카테고리인 카드 전부를 `to` 로. `to` 가 '' 이면 카테고리 제거. */
export function renameCategory(deck: Deck, from: string, to: string): Deck {
  const value = to.trim();
  if (from === value) return deck;
  let changed = false;
  const cards = deck.cards.map((c) => {
    if ((c.category ?? "").trim() !== from) return c;
    changed = true;
    return recategorize(c, value);
  });
  return changed ? { ...deck, cards } : deck;
}

function recategorize(card: Card, value: string): Card {
  const next: Card = { ...card };
  if (value) next.category = value;
  else delete next.category;
  return FCD.orderKeys(next);
}

/**
 * 루트 설정 부분 갱신. 빈 문자열이 된 부제는 키째 지운다 —
 * 저장 JSON 에 `"subtitle": ""` 이 남으면 diff 가 지저분해진다.
 */
export function patchDeck(deck: Deck, patch: Partial<Deck>): Deck {
  const next: Deck = { ...deck, ...patch };
  if (!next.subtitle) delete next.subtitle;
  return next;
}

/** 등장 순서대로 모은 카테고리. 칩 필터가 이 순서로 나온다. */
export function categoriesOf(deck: Deck): string[] {
  const out: string[] = [];
  for (const c of deck.cards) {
    const v = (c.category ?? "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** id 를 1..n 으로 다시 매긴다. 기존 학습 기록과 어긋나므로 호출부가 경고한다. */
export function renumberCards(deck: Deck): Deck {
  return { ...deck, cards: deck.cards.map((c, i) => FCD.orderKeys({ ...c, id: i + 1 })) };
}

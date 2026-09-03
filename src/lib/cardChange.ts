/**
 * 카드 형식 바꾸기 — 내용을 **역할이 같은 자리로** 옮긴다.
 *
 * 형식마다 쓰는 필드가 다르므로(`CARD_TYPES[type].fields`) 단순히 type 만 갈면
 * 앞면·뒷면이 통째로 사라진 빈 카드가 된다. 사람은 "질문 / 답 / 순서" 를 옮긴 것으로
 * 기대하지 basic 의 back 이 cloze 의 어느 필드로 갔는지를 생각하지 않는다.
 *
 * 옮길 수 없어 버린 것은 `dropped` 에 값 요약과 함께 담아 폼이 사용자에게 밝힌다 —
 * 조용히 사라지는 것이 가장 나쁘다.
 */
import { FCD } from "../engine/boot";
import type { Card, CardType } from "../engine/types";

/** 형식을 바꾼 결과. `dropped` 가 비어 있으면 손실 없이 옮겨졌다는 뜻이다. */
export interface ChangeResult {
  card: Card;
  dropped: string[];
}

const BLANK = /\{\{([^}]*)\}\}/g;

/** 어절의 앞뒤에 붙은 문장부호 — 빈칸은 낱말만 감싸고 마침표는 밖에 둔다. */
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** dropped 메시지에 값을 짧게 인용한다 — 무엇을 잃었는지 알아야 되돌릴지 판단한다. */
function quote(s: string): string {
  const t = FCD.plain(s);
  return `"${t.length > 16 ? t.slice(0, 16) + "…" : t}"`;
}

/**
 * 뒷면을 단계로 쪼갠다. 사람이 순서를 적는 세 가지 방식 — 줄바꿈 · 화살표 · 번호 목록 —
 * 을 모두 받는다.
 */
function splitSteps(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    for (const seg of line.split(/\s*(?:->|→|=>|⇒)\s*/)) {
      for (const piece of seg.split(/(?:^|\s)(?=\d+[.)]\s)/)) {
        const t = piece.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "").trim();
        if (t) out.push(t);
      }
    }
  }
  return out;
}

/**
 * 문장에서 가장 긴 어절 하나를 빈칸으로 만든다. 답이 문맥 안에 남아야 cloze 가
 * 성립하므로, 답을 문장 밖으로 빼는 대신 문장 자체에 구멍을 낸다.
 * 어절이 하나뿐이면 null — 호출부가 질문 뒤에 답을 붙이는 쪽으로 되돌아간다.
 */
function blankLongest(sentence: string): string | null {
  const tokens = sentence.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  let best = -1;
  let bestLen = 0;
  tokens.forEach((tok, i) => {
    const core = tok.replace(EDGE, "");
    if (core.length > bestLen) {
      bestLen = core.length;
      best = i;
    }
  });
  if (best < 0) return null;
  const tok = tokens[best];
  const core = tok.replace(EDGE, "");
  const at = tok.indexOf(core);
  tokens[best] = `${tok.slice(0, at)}{{${core}}}${tok.slice(at + core.length)}`;
  return tokens.join(" ");
}

/** 빈칸을 지운 문장 — 답이 사라져도 질문의 뼈대는 남는다. */
function stripBlanks(text: string): string {
  return text
    .replace(BLANK, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function changeType(card: Card, next: CardType): ChangeResult {
  if (card.type === next) return { card, dropped: [] };

  const dropped: string[] = [];
  const front = (card.front ?? "").trim();
  const back = (card.back ?? "").trim();
  const text = card.text ?? "";
  const items = (card.items ?? []).map((s) => String(s).trim()).filter(Boolean);
  const answers = FCD.clozeAnswers(text).filter(Boolean);

  /* 형식과 무관하게 남는 것들 — 번호·갈래·맥락·보충은 형식을 가리지 않는다 */
  const out: Card = {
    id: card.id,
    type: next,
    category: card.category,
    context: card.context,
    note: card.note,
  };

  if (card.type === "basic" && card.choices?.length) {
    dropped.push(`객관식 오답 ${card.choices.length}개를 버렸다 — basic 에만 있는 자리다`);
  }

  if (next === "cloze") {
    if (card.type === "sequence") {
      out.text = items.map((s) => `{{${s}}}`).join(" → ");
      if (front) dropped.push(`앞면 ${quote(front)} 을 버렸다 — 빈칸 문장에는 질문 자리가 없다`);
    } else {
      /* 코드 블록은 한 줄 문장이 될 수 없다 — 마크다운을 벗겨 문장만 남긴다 */
      let body = back;
      if (/```/.test(body)) {
        body = FCD.plain(body);
        dropped.push("코드 블록을 버렸다 — 빈칸 문장은 한 줄이다");
      }
      const source = body || front;
      const blanked = blankLongest(source);
      if (blanked) {
        out.text = blanked;
        if (body && front) dropped.push(`앞면 ${quote(front)} 을 버렸다 — 답이 문장 안으로 들어갔다`);
      } else {
        /* 답이 한 낱말이면 문장에 구멍을 낼 수 없다 — 질문 뒤에 답을 붙인다 */
        out.text = [front, body && `{{${body}}}`].filter(Boolean).join(" ");
      }
    }
    /* 빈칸이 하나도 없는 cloze 는 카드가 아니다 — 남은 문장을 통째로 감싼다 */
    if (out.text && !FCD.clozeAnswers(out.text).length) out.text = `{{${out.text}}}`;
  } else if (next === "sequence") {
    if (card.type === "cloze") {
      out.front = stripBlanks(text) || text.replace(/[{}]/g, "").trim();
      out.items = answers;
      if (answers.length < 2) {
        dropped.push(`빈칸이 ${answers.length}개뿐이라 두 번째 항목을 비워 뒀다`);
        out.items = [answers[0] ?? "", ""];
      }
    } else {
      out.front = front;
      out.items = splitSteps(back);
      if (out.items.length < 2) {
        dropped.push(`뒷면 ${quote(back)} 을 단계로 쪼갤 수 없어 두 번째 항목을 비워 뒀다`);
        out.items = [back, ""];
      }
    }
  } else if (card.type === "cloze") {
    out.front = text.replace(BLANK, "____").trim();
    out.back = answers.join(" / ");
    if (!answers.length) dropped.push("빈칸이 없어 뒷면이 비었다 — 답을 직접 적는다");
  } else {
    out.front = front;
    out.back = items.map((s, i) => `${i + 1}. ${s}`).join("\n");
  }

  return { card: FCD.orderKeys(FCD.normalizeCard(out)), dropped };
}

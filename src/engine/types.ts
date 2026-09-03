/**
 * 엔진(`vendor/flashcards/assets/deckcards.js`) 의 공개 표면과 덱 스펙 타입.
 *
 * 엔진은 UMD 자바스크립트라 타입이 없다 — 이 파일이 그 계약을 적어 둔 유일한 곳이다.
 * 엔진을 갈아끼웠으면 여기부터 맞춘다.
 */

export type CardType = "basic" | "cloze" | "sequence";
export type QuizMode = "off" | "auto" | "choice" | "typing";

/** 카드 한 장. 형식에 따라 쓰는 필드가 다르다 (CARD_TYPES.fields). */
export interface Card {
  id: number;
  type: CardType;
  category?: string;
  /** 스토리라인 덱의 "지금까지: …" — 앞면 상단 작은 글씨 */
  context?: string;
  /** basic · sequence */
  front?: string;
  /** basic */
  back?: string;
  /** cloze — `{{정답}}` 이 빈칸이 된다 */
  text?: string;
  /** sequence — 반드시 올바른 순서로 */
  items?: string[];
  /** basic — 객관식 오답을 직접 지정 (비우면 다른 카드 답에서 자동 추출) */
  choices?: string[];
  note?: string;
}

/** 덱 스펙 — CONFIG 와 DECK 을 한 파일에 담은 모양. 이것이 저장·열기 단위다. */
export interface Deck {
  /** localStorage 키. 내용을 크게 바꾸면 -v2 로 올린다 */
  id: string;
  title: string;
  subtitle?: string;
  /** 서사형 덱 — 셔플 기본 OFF + 셔플 시 경고 배지 */
  story?: boolean;
  quiz?: QuizMode;
  /** 앞↔뒤 방향 전환 (외국어 단어장) */
  reverse?: boolean;
  autoplaySec?: number;
  /** 프리셋 이름 또는 #RRGGBB */
  accent?: string;
  /** 카드 비율 `가로/세로` */
  ratio?: string;
  cards: Card[];
}

export interface CardTypeDef {
  label: string;
  use: string;
  required: string[];
  fields: string[];
}

export interface Palette {
  hex: string;
  accent: string;
  lite: string;
  tint: string;
  dark: string;
  darkLite: string;
  darkTint: string;
  contrastLight: number;
  contrastDark: number;
}

export interface DeckStats {
  cards: number;
  types: Record<string, number>;
  categories: string[];
  uncategorized: number;
  quiz: { choice: number; typing: number; blank: number; total: number };
  excludedFromQuiz: number;
  mermaid: number;
  images: number;
  externalImages: number;
  clozeBlanks: number;
  withContext: number;
  chars: number;
  accent: string;
  ratio: string;
  quizMode: QuizMode;
  story: boolean;
  reverse: boolean;
  autoplaySec: number;
  autoplayTotalSec: number;
}

/** 검증 결과의 카드 한 줄 — 목록·CLI 가 같은 값을 읽는다. */
export interface CardRow {
  n: number;
  id: number | undefined;
  type: CardType;
  category: string | null;
  label: string;
  chars: number;
  /** null 이면 퀴즈에서 빠진다 */
  quiz: "choice" | "typing" | "blank" | null;
  issues: string[];
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: DeckStats;
  cards: CardRow[];
}

export interface CheckLine {
  ok: boolean;
  label: string;
  why?: string;
}

export interface CheckResult {
  lines: CheckLine[];
  info: string;
  fail: number;
  cards: number;
}

export interface ImportResult {
  cards: Card[];
  warnings: string[];
  format: "csv" | "tsv" | "md" | "anki";
}

export interface BuildOpts {
  /** base.html 소스 (필수) */
  base: string;
  /** 미리보기 훅(window.FCP) 을 얹는다 */
  preview?: boolean;
}

/** 산출물에 실리는 미리보기 훅. `preview` 빌드에만 있다. */
export interface PreviewHook {
  version: string;
  cards: { id: number; type: CardType; category: string | null }[];
  goto(id: number): boolean;
  flip(v?: boolean): boolean;
  view(v: "study" | "quiz"): string;
  present(on?: boolean): boolean;
  reveal(): void;
  category(c: string): string;
  reset(): void;
  state(): {
    index: number;
    id: number | null;
    total: number;
    flipped: boolean;
    category: string;
    view: "study" | "quiz";
    present: boolean;
  };
}

export interface Engine {
  version: string;
  CARD_TYPES: Record<CardType, CardTypeDef>;
  QUIZ_MODES: Record<QuizMode, string>;
  ACCENTS: Record<string, { label: string; hex: string }>;
  RATIOS: Record<string, string>;
  CARD_KEYS: string[];
  CONFIG_DEFAULTS: Record<string, unknown>;

  normalize(spec: unknown): { config: Record<string, unknown>; accent: string; ratio: string; cards: Card[] };
  normalizeCard(card: unknown): Card;
  orderKeys(card: Card): Card;
  blankCard(type: CardType, id: number): Card;
  nextId(cards: Card[]): number;

  validate(spec: unknown): ValidateResult;
  stats(spec: unknown): DeckStats;
  toHTML(spec: unknown, opts: BuildOpts): string;
  check(html: string): CheckResult;

  parseImport(text: string, opts?: { format?: string; startId?: number }): ImportResult;
  detectFormat(text: string): "csv" | "tsv" | "md";
  toCsv(spec: unknown): string;

  palette(accent: string): Palette | null;
  contrast(a: string | number[], b: string | number[]): number;
  plain(s: string): string;
  clozeAnswers(text: string): string[];
  hasMermaid(card: Card): boolean;
  imageSrcs(card: Card): string[];
  sentences(s: string): number;
  quizModeOf(cards: Card[], card: Card, quiz: QuizMode): "choice" | "typing" | "blank" | null;
}

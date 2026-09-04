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
  /** quiz==='choice' 에서 오답이 3개를 못 채워 출제에서 빠진 basic 장수 */
  choiceDropped: number;
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

/** `parseImport` 의 열 역할. null 은 버리는 열. */
export type ImportColumn = "front" | "back" | "category" | "note" | "context" | null;

/** 읽지 못하고 버린 줄 — 사람이 원문에서 찾아 고칠 수 있게 위치와 이유를 남긴다. */
export interface ImportDrop {
  /** 원문 줄 번호 (1부터). 표 형식이면 행 번호 */
  line: number;
  text: string;
  reason: string;
}

export interface ImportResult {
  cards: Card[];
  /** 사람이 읽는 경고 문장 — 버린 줄 요약·답 없는 카드 등 */
  warnings: string[];
  format: "csv" | "tsv" | "md" | "anki";
  /** 실제로 적용된 열 매핑 (표 형식). md 는 ['front','back'] */
  columns: ImportColumn[];
  /** 첫 줄을 머리글로 읽었는가 */
  header: boolean;
  /** 읽은 행(줄) 수 — 버린 줄 포함 */
  rows: number;
  dropped: ImportDrop[];
}

/** Rust `read_apkg` 가 돌려주는 Anki 패키지. 필드 값은 Anki 의 HTML 그대로다 — `FCD.ankiHtml` 로 옮긴다. */
export interface ApkgImport {
  deck_name: string | null;
  notetypes: { id: string; name: string; fields: string[] }[];
  notes: { notetype: string; fields: string[]; tags: string[] }[];
  /** 미디어 파일명 → data URI. 이미지만 담는다 */
  media: Record<string, string>;
  /** 이미지가 아니라 뺀 미디어 개수 (소리·영상) */
  skipped_media: number;
  format: "anki2" | "anki21" | "anki21b";
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
  /**
   * DECK 을 제자리에서 갈아끼우고 현재 카드를 다시 그린다 — 문서를 다시 로드하지 않으므로
   * 학습 진행·스크롤·탭이 유지된다. CONFIG(제목·퀴즈 모드·색·비율)나 mermaid CDN 유무가
   * 바뀌면 이걸로는 안 되고 문서를 다시 빌드해야 한다.
   */
  update(cards: Card[]): boolean;
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

  parseImport(
    text: string,
    opts?: { format?: string; startId?: number; columns?: ImportColumn[]; header?: "auto" | boolean },
  ): ImportResult;
  /** 이미 행으로 쪼개진 표(apkg 노트 등) → 카드. parseImport 가 안에서 쓰는 것과 같은 함수 */
  rowsToCards(
    rows: string[][],
    columns: ImportColumn[],
    opts?: { startId?: number },
  ): { cards: Card[]; warnings: string[]; dropped: ImportDrop[] };
  /** Anki 필드 HTML → 카드 markdown 부분집합. `{{c1::답::힌트}}` 는 `{{답}}` 으로, `<img src>` 는 media 의 data URI 로 */
  ankiHtml(html: string, media?: Record<string, string>): string;
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

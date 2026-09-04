/**
 * 표·목록·Anki 패키지 가져오기.
 *
 * 이미 있는 단어장을 다시 타이핑하지 않게 하는 것이 이 패널의 전부다. 붙여넣은
 * 원문을 엔진의 `parseImport` 에 그대로 넘기고, 읽어낸 결과를 먼저 보여준 다음
 * 사용자가 확인하고 나서 덱에 넣는다 — 파싱은 추측이 섞이므로 미리보기가 없으면
 * 덱을 망친 뒤에야 알게 된다. 같은 이유로 열 매핑도 파서의 추론을 초기값으로만 쓰고
 * 사람이 표에서 고칠 수 있게 둔다.
 *
 * apkg 는 Rust 가 sqlite 를 풀어 노트 필드(HTML)와 이미지(data URI)를 넘기고, 여기서
 * `ankiHtml` 로 카드 문법에 옮긴 뒤 표 가져오기와 같은 `rowsToCards` 길로 흘린다 —
 * 두 길이 결과 화면(장수·경고·버린 줄·앞 5장)을 공유하는 이유다.
 */
import { useMemo, useState } from "react";
import { FCD } from "../engine/boot";
import { HAS_TAURI, api, dialogs, pickTextFile } from "../lib/tauri";
import type { ApkgImport, Card, ImportColumn, ImportDrop, ImportResult } from "../engine/types";
import { ImportMapping } from "./ImportMapping";

type Format = "auto" | "csv" | "tsv" | "md" | "anki" | "apkg";

const FORMATS: { value: Format; label: string }[] = [
  { value: "auto", label: "자동 — 원문을 보고 고른다" },
  { value: "csv", label: "csv — 쉼표로 나뉜 표" },
  { value: "tsv", label: "tsv — 탭으로 나뉜 표(스프레드시트 복사)" },
  { value: "md", label: "md — 목록 한 줄에 한 장" },
  { value: "anki", label: "anki — 내보낸 탭 구분 텍스트" },
  { value: "apkg", label: "apkg — Anki 패키지(.apkg)" },
];

/** 버린 줄은 이만큼만 펼쳐 보인다 — 수백 줄이 버려졌으면 원문이 표가 아니라는 뜻이고, 다 볼 필요가 없다. */
const DROP_SHOWN = 5;
/** 산출물에 실리는 그림이 이 크기를 넘으면 경고한다 — 단일 HTML 이 수 MB 가 되면 여는 데 눈에 띄게 걸린다. */
const HEAVY_MEDIA_BYTES = 400 * 1024;

interface NoteType {
  id: string;
  name: string;
  fields: string[];
  count: number;
}

interface Parsed {
  result: ImportResult | null;
  crash: string;
  /** 매핑 표 옆에 흐리게 놓는 첫 데이터 행 */
  samples: string[];
  /** apkg 일 때만 — 카드에 실제로 실린 그림 수·크기 */
  media: { images: number; bytes: number } | null;
}

const EMPTY: Parsed = { result: null, crash: "", samples: [], media: null };

/**
 * 표 원문에서 첫 데이터 행을 셀로 쪼갠다 — 매핑 표 옆의 미리보기용.
 * 엔진 파서를 흉내내지만 인용부호 정도만 본다. 미리보기는 참고일 뿐 카드에 들어가지 않으므로
 * 엔진과 완전히 같을 필요가 없고, 파서의 내부 행을 계약에 노출하지 않는 편이 낫다.
 */
function sampleRow(text: string, format: ImportResult["format"], header: boolean): string[] {
  const delim = format === "csv" ? "," : "\t";
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !(format === "anki" && l.startsWith("#")));
  const line = lines[header ? 1 : 0];
  if (!line) return [];
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && !cur) quoted = true;
    else if (ch === delim) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/**
 * apkg 노트 타입의 기본 필드 매핑.
 * Anki 의 기본 노트 타입은 필드 순서가 앞·뒤이고, 보충은 관례적으로 `Extra`/`Back Extra` 다.
 * Cloze 타입은 `Text` 한 필드에 `{{c1::}}` 가 들어 있고 뒷면이 없다 — 앞면만 매핑하면 엔진이
 * "답 없이 {{ }} 만 있는 카드" 규칙으로 빈칸 카드로 읽는다.
 */
function defaultApkgColumns(type: NoteType): ImportColumn[] {
  const cols: ImportColumn[] = type.fields.map(() => null);
  if (!cols.length) return cols;
  if (/cloze/i.test(type.name)) {
    const text = type.fields.findIndex((f) => /^text$/i.test(f));
    cols[text >= 0 ? text : 0] = "front";
  } else {
    cols[0] = "front";
    if (cols.length > 1) cols[1] = "back";
  }
  const extra = type.fields.findIndex((f) => /^(back )?extra$/i.test(f));
  if (extra >= 0 && cols[extra] === null) cols[extra] = "note";
  return cols;
}

/**
 * 패키지의 노트 타입 목록 — 노트가 많은 순. 모델 정의가 빠진 노트(Rust 가 못 찾은 id)도
 * 한 항목으로 세운다: 필드 이름은 없으니 번호로 부르고, 순서 매핑은 그대로 쓸 수 있다.
 */
function noteTypesOf(pkg: ApkgImport): NoteType[] {
  const counts = new Map<string, number>();
  for (const n of pkg.notes) counts.set(n.notetype, (counts.get(n.notetype) ?? 0) + 1);
  const list: NoteType[] = pkg.notetypes.map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }));
  for (const [id, count] of counts) {
    if (list.some((t) => t.id === id)) continue;
    let width = 0;
    for (const n of pkg.notes) if (n.notetype === id) width = Math.max(width, n.fields.length);
    list.push({
      id,
      name: `(알 수 없는 노트 타입 ${id})`,
      fields: Array.from({ length: width }, (_, i) => `필드 ${i + 1}`),
      count,
    });
  }
  return list.sort((a, b) => b.count - a.count);
}

export function ImportPanel(props: {
  onImport(cards: Card[], mode: "append" | "replace"): void;
  onToast(msg: string, kind?: "ok" | "err"): void;
}) {
  const [text, setText] = useState("");
  const [format, setFormat] = useState<Format>("auto");
  const [busy, setBusy] = useState(false);
  /* 열 매핑·머리글은 "사용자가 고친 값" 만 상태로 들고, null 이면 파서의 추론을 따른다.
     원문이나 형식이 바뀌면 열의 의미가 달라지므로 그때 둘 다 null 로 돌린다. */
  const [columnsOverride, setColumnsOverride] = useState<ImportColumn[] | null>(null);
  const [headerOverride, setHeaderOverride] = useState<boolean | null>(null);

  const [apkg, setApkg] = useState<ApkgImport | null>(null);
  /* null 이면 노트가 가장 많은 타입. 필드 매핑 override 는 타입이 바뀌면 의미가 없어 같이 비운다. */
  const [noteTypeId, setNoteTypeId] = useState<string | null>(null);
  const [fieldsOverride, setFieldsOverride] = useState<ImportColumn[] | null>(null);
  const [tagsAsCategory, setTagsAsCategory] = useState(true);

  const updateText = (t: string) => {
    setText(t);
    setColumnsOverride(null);
    setHeaderOverride(null);
  };
  const updateFormat = (f: Format) => {
    setFormat(f);
    setColumnsOverride(null);
    setHeaderOverride(null);
  };

  const noteTypes = useMemo(() => (apkg ? noteTypesOf(apkg) : []), [apkg]);
  const noteType = noteTypes.find((t) => t.id === noteTypeId) ?? noteTypes[0] ?? null;
  const fieldColumns = useMemo(
    () => (noteType ? fieldsOverride ?? defaultApkgColumns(noteType) : []),
    [noteType, fieldsOverride],
  );

  /* 엔진 파싱은 입력이 아무 모양이나 될 수 있다 — 던져도 패널이 죽지 않게 감싼다. */
  const parsed = useMemo<Parsed>(() => {
    try {
      if (format === "apkg") {
        if (!apkg || !noteType) return EMPTY;
        /* 태그는 항상 마지막 열로 붙이고 역할만 바꾼다 — 매핑에서 카테고리 열을 따로 고르면 태그는 버린다. */
        const tagColumn: ImportColumn =
          tagsAsCategory && !fieldColumns.includes("category") ? "category" : null;
        const columns = [...fieldColumns, tagColumn];
        const rows: string[][] = [];
        for (const n of apkg.notes) {
          if (n.notetype !== noteType.id) continue;
          const row = noteType.fields.map((_, i) => FCD.ankiHtml(n.fields[i] ?? "", apkg.media));
          row.push(n.tags[0] ?? "");
          rows.push(row);
        }
        const r = FCD.rowsToCards(rows, columns, { startId: 1 });
        let images = 0;
        let bytes = 0;
        for (const row of rows)
          for (const cell of row)
            for (const m of cell.matchAll(/data:image\/[^)\s"'>]+/g)) {
              images++;
              bytes += m[0].length;
            }
        return {
          result: { ...r, format: "anki", columns, header: false, rows: rows.length },
          crash: "",
          samples: rows[0] ?? [],
          media: { images, bytes },
        };
      }
      if (!text.trim()) return EMPTY;
      const result = FCD.parseImport(text, {
        format,
        startId: 1,
        columns: columnsOverride ?? undefined,
        header: headerOverride ?? "auto",
      });
      return {
        result,
        crash: "",
        samples: result.format === "md" ? [] : sampleRow(text, result.format, result.header),
        media: null,
      };
    } catch (e) {
      return { ...EMPTY, crash: String(e) };
    }
  }, [text, format, columnsOverride, headerOverride, apkg, noteType, fieldColumns, tagsAsCategory]);

  /* 자동일 때 실제로 어떤 형식으로 읽었는지 알려 준다 — 틀렸으면 직접 고르면 된다. */
  const detected = useMemo(() => {
    if (format !== "auto" || !text.trim()) return "";
    try {
      return FCD.detectFormat(text);
    } catch {
      return "";
    }
  }, [format, text]);

  const result = parsed.result;
  const cards = result ? result.cards : [];
  /* `cards` 는 파싱 결과에서 매번 새로 나오는 배열이라 그 자체를 의존성으로 쓸 수 없다 —
     의존성은 파싱 결과 하나로 두고 개수 세기만 여기서 한다. */
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of result?.cards ?? []) counts[c.type] = (counts[c.type] ?? 0) + 1;
    return Object.entries(counts);
  }, [result]);

  /* 표 매핑의 너비: 파서가 본 열 수와 첫 행의 셀 수 중 큰 쪽 — 파서가 뒤쪽 열을 잘랐어도 사용자가 살릴 수 있게. */
  const tableColumns = useMemo<ImportColumn[]>(() => {
    if (!result || format === "apkg" || result.format === "md") return [];
    const width = Math.max(result.columns.length, parsed.samples.length);
    return Array.from({ length: width }, (_, i) => result.columns[i] ?? null);
  }, [result, format, parsed.samples]);

  const mappedColumns = format === "apkg" ? fieldColumns : result?.columns ?? [];
  const frontMissing = result !== null && !mappedColumns.includes("front");
  const canImport = cards.length > 0 && !frontMissing;

  const load = async () => {
    setBusy(true);
    try {
      if (HAS_TAURI) {
        const path = await dialogs.openTable();
        if (path) {
          updateText(await api.readText(path));
          props.onToast("파일을 읽었다");
        }
      } else {
        const picked = await pickTextFile(".csv,.tsv,.txt,.md");
        if (picked) {
          updateText(picked.text);
          props.onToast(`${picked.name} 을 읽었다`);
        }
      }
    } catch (e) {
      props.onToast(String(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const loadApkg = async () => {
    setBusy(true);
    try {
      const path = await dialogs.openApkg();
      if (path) {
        const pkg = await api.readApkg(path);
        setApkg(pkg);
        setNoteTypeId(null);
        setFieldsOverride(null);
        props.onToast(`${pkg.deck_name ?? "Anki 패키지"} — 노트 ${pkg.notes.length}개를 읽었다`);
      }
    } catch (e) {
      props.onToast(String(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-body">
      <div className="field">
        <label className="field-label">형식</label>
        <select
          className="select"
          value={format}
          onChange={(e) => updateFormat(e.target.value as Format)}
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="field-hint">
          csv · tsv 는 <span className="mono">앞면,뒷면[,카테고리,보충]</span> — 머리글(앞면/뒷면 ·
          front/back)이 있으면 알아서 읽고, 아래 매핑 표에서 고칠 수 있다. md 는{" "}
          <span className="mono">앞면 :: 뒷면</span> 또는 <span className="mono">앞면 | 뒷면</span>.
          답 칸 없이 <span className="mono">{"{{ }}"}</span> 만 있으면 빈칸 카드, 답이{" "}
          <span className="mono">-&gt;</span> · <span className="mono">→</span> 로 이어지면 순서
          카드로 읽는다. apkg 는 Anki 가 내보낸 패키지 — 노트 필드의 HTML 을 카드 문법으로
          옮기고 이미지는 산출물 안에 심는다(소리·영상은 뺀다).
        </div>
      </div>

      {format === "apkg" ? (
        <div className="field">
          <label className="field-label">
            Anki 패키지
            {apkg ? <span className="badge mute">{apkg.format}</span> : null}
          </label>
          <div className="row tight">
            <button
              type="button"
              className="btn sm"
              disabled={busy || !HAS_TAURI}
              onClick={() => void loadApkg()}
            >
              Anki 패키지 열기
            </button>
            {apkg ? (
              <button type="button" className="btn sm ghost" onClick={() => setApkg(null)}>
                비우기
              </button>
            ) : null}
          </div>
          {!HAS_TAURI ? (
            <div className="field-hint">
              브라우저 모드에서는 apkg 를 읽을 수 없다 — 패키지 안의 sqlite 를 푸는 건 네이티브
              앱만 한다.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="field">
          <label className="field-label">
            원문
            {detected ? <span className="badge">{detected} 로 읽는다</span> : null}
          </label>
          <textarea
            className="textarea"
            style={{ minHeight: 140 }}
            value={text}
            placeholder={"앞면,뒷면,카테고리\n미토콘드리아,세포의 에너지 공장,생물"}
            onChange={(e) => updateText(e.target.value)}
          />
          <div className="row tight">
            <button type="button" className="btn sm" disabled={busy} onClick={() => void load()}>
              파일에서 읽기
            </button>
            <button
              type="button"
              className="btn sm ghost"
              disabled={!text}
              onClick={() => updateText("")}
            >
              비우기
            </button>
          </div>
        </div>
      )}

      {format === "apkg" && apkg && noteType ? (
        <>
          <div className="row tight">
            <span className="badge">{apkg.deck_name ?? "(이름 없는 덱)"}</span>
            <span className="badge mute">노트 {apkg.notes.length}개</span>
            <span className="badge mute">이미지 {Object.keys(apkg.media).length}개</span>
            {apkg.skipped_media > 0 ? (
              <span className="badge mute">소리·영상 {apkg.skipped_media}개는 뺐다</span>
            ) : null}
            {parsed.media && parsed.media.images > 0 ? (
              <span
                className={parsed.media.bytes > HEAVY_MEDIA_BYTES ? "badge warn" : "badge mute"}
                title="카드에 실리는 data URI 의 총 크기"
              >
                그림 {parsed.media.images}장 · {Math.round(parsed.media.bytes / 1024)} KB
                {parsed.media.bytes > HEAVY_MEDIA_BYTES ? " — 산출물이 무거워진다" : ""}
              </span>
            ) : null}
          </div>

          <div className="field">
            <label className="field-label">노트 타입</label>
            <select
              className="select"
              value={noteType.id}
              onChange={(e) => {
                setNoteTypeId(e.target.value);
                setFieldsOverride(null);
              }}
            >
              {noteTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — 노트 {t.count}개
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label">필드 매핑</label>
            <ImportMapping
              names={noteType.fields}
              columns={fieldColumns}
              samples={parsed.samples}
              onChange={(i, c) => {
                const next = fieldColumns.slice();
                next[i] = c;
                setFieldsOverride(next);
              }}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={tagsAsCategory}
                onChange={(e) => setTagsAsCategory(e.target.checked)}
              />
              <span>태그를 카테고리로 (첫 태그만 — 카테고리 필드를 따로 고르면 그게 우선)</span>
            </label>
          </div>
        </>
      ) : null}

      {parsed.crash ? (
        <div className="diag err">
          <span className="diag-mark">✕</span>
          <span>{parsed.crash}</span>
        </div>
      ) : null}

      {result && tableColumns.length ? (
        <div className="field">
          <label className="field-label">열 매핑</label>
          <ImportMapping
            names={tableColumns.map((_, i) => `${i + 1}열`)}
            columns={tableColumns}
            samples={parsed.samples}
            onChange={(i, c) => {
              const next = tableColumns.slice();
              next[i] = c;
              setColumnsOverride(next);
            }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={result.header}
              onChange={(e) => setHeaderOverride(e.target.checked)}
            />
            <span>첫 줄은 머리글</span>
          </label>
        </div>
      ) : null}

      {result ? (
        <>
          <div className="row tight">
            <span className={cards.length ? "badge ok" : "badge err"}>카드 {cards.length}장</span>
            {typeCounts.map(([t, n]) => (
              <span key={t} className="badge mute">
                {FCD.CARD_TYPES[t as Card["type"]]?.label ?? t} {n}
              </span>
            ))}
            {result.dropped.length ? (
              <span className="badge warn">버린 줄 {result.dropped.length}</span>
            ) : null}
          </div>

          {frontMissing ? (
            <div className="diag err">
              <span className="diag-mark">✕</span>
              <span>
                앞면으로 매핑된 {format === "apkg" ? "필드" : "열"}이 없다 — 매핑 표에서 하나를
                앞면으로 고르면 읽는다.
              </span>
            </div>
          ) : null}

          {result.warnings.map((w, i) => (
            <div className="diag warn" key={i}>
              <span className="diag-mark">!</span>
              <span>{w}</span>
            </div>
          ))}

          {result.dropped.length ? <DroppedList dropped={result.dropped} /> : null}

          {cards.length ? (
            <div className="field">
              <label className="field-label">앞 5장</label>
              <div className="list">
                {cards.slice(0, 5).map((c, i) => (
                  <div className="card-row" key={c.id}>
                    <div className="card-row-n">{i + 1}</div>
                    <div className="card-row-main">
                      <div className="card-row-label">
                        {FCD.plain(c.text || c.front || c.back || "") || "(빈 카드)"}
                      </div>
                      <div className="card-row-meta">
                        <span>{FCD.CARD_TYPES[c.type]?.label ?? c.type}</span>
                        {c.category ? <span>· {c.category}</span> : null}
                        {c.items ? <span>· {c.items.length}단계</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {cards.length > 5 ? (
                <div className="field-hint">…외 {cards.length - 5}장</div>
              ) : null}
            </div>
          ) : null}

          <div className="row tight">
            <button
              type="button"
              className="btn primary"
              disabled={!canImport}
              onClick={() => props.onImport(cards, "append")}
            >
              이어붙이기
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={!canImport}
              onClick={() => props.onImport(cards, "replace")}
            >
              덱 교체
            </button>
          </div>
          <div className="field-hint">
            여기서는 id 를 1부터 매겨 읽는다 — 이어붙이면 덱에 넣은 뒤 전체 번호를 다시 매긴다.
          </div>
        </>
      ) : !parsed.crash ? (
        <div className="list-empty">
          {format === "apkg"
            ? "Anki 패키지를 열면 읽어낸 카드를 먼저 보여준다."
            : "원문을 붙여넣으면 읽어낸 카드를 먼저 보여준다."}
        </div>
      ) : null}
    </div>
  );
}

/** 버린 줄 — 사람이 원문에서 찾아 고칠 수 있게 위치·이유·앞부분을 보인다. 경고 아래 접어 둔다. */
function DroppedList(props: { dropped: ImportDrop[] }) {
  const shown = props.dropped.slice(0, DROP_SHOWN);
  const rest = props.dropped.length - shown.length;
  return (
    <details className="fold">
      <summary>버린 줄 {props.dropped.length}개 — 읽지 못해 카드가 되지 않은 줄</summary>
      {shown.map((d) => (
        <div className="diag warn" key={d.line}>
          <span className="diag-mark">!</span>
          <span>
            {d.line}줄: {d.reason}
            <span className="diag-why">
              {" — "}
              {d.text.length > 40 ? `${d.text.slice(0, 40)}…` : d.text}
            </span>
          </span>
        </div>
      ))}
      {rest > 0 ? <div className="field-hint">…외 {rest}줄</div> : null}
    </details>
  );
}

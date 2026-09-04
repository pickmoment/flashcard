/**
 * 열(필드) → 카드 역할 매핑 표.
 *
 * 표 가져오기와 apkg 가져오기가 같은 표를 쓴다 — 한쪽은 열 번호, 한쪽은 필드 이름이
 * 왼쪽에 서는 것만 다르다. 파서의 추론은 자주 맞지만 항상 맞지는 않아서(머리글 없는
 * 뒷면·앞면 순서, 세 번째 열이 카테고리인지 보충인지) 사람이 한 번 훑고 고칠 수 있어야 한다.
 * 첫 데이터 행을 옆에 흐리게 두는 건 이름만으로는 어느 열이 무엇인지 알 수 없기 때문이다.
 */
import type { ImportColumn } from "../engine/types";

const COLUMN_OPTIONS: { value: ImportColumn; label: string }[] = [
  { value: "front", label: "앞면" },
  { value: "back", label: "뒷면" },
  { value: "category", label: "카테고리" },
  { value: "note", label: "보충" },
  { value: "context", label: "문맥" },
  { value: null, label: "버림" },
];

/* select 의 value 는 문자열이어야 해서 null(버림)만 빈 문자열로 오간다. */
const toValue = (c: ImportColumn) => c ?? "";

export function ImportMapping(props: {
  /** 왼쪽 칸에 쓸 이름 — 열 번호("1열") 또는 apkg 필드명 */
  names: string[];
  columns: ImportColumn[];
  /** 첫 데이터 행의 값. 없는 칸은 빈 문자열 */
  samples: string[];
  onChange(index: number, column: ImportColumn): void;
}) {
  return (
    <div className="map-table">
      {props.names.map((name, i) => (
        <MappingRow
          key={i}
          name={name}
          column={props.columns[i] ?? null}
          sample={props.samples[i] ?? ""}
          onChange={(c) => props.onChange(i, c)}
        />
      ))}
    </div>
  );
}

function MappingRow(props: {
  name: string;
  column: ImportColumn;
  sample: string;
  onChange(column: ImportColumn): void;
}) {
  return (
    <>
      <span className="mono" title={props.name}>
        {props.name}
      </span>
      <select
        className="select"
        value={toValue(props.column)}
        onChange={(e) =>
          props.onChange(e.target.value === "" ? null : (e.target.value as ImportColumn))
        }
      >
        {COLUMN_OPTIONS.map((o) => (
          <option key={toValue(o.value)} value={toValue(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="map-sample" title={props.sample}>
        {props.sample || "\u00a0"}
      </span>
    </>
  );
}

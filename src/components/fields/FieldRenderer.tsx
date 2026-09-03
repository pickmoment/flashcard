/**
 * 스키마 한 줄을 입력 위젯 하나로 그린다.
 *
 * 라벨·필수 표시·힌트는 여기서만 그린다. 위젯마다 제 라벨을 그리면 필수 표시가
 * 스키마와 어긋나기 시작한다 — 검증이 오류라고 말하는데 폼은 조용한 상태가 된다.
 */
import type { FieldSpec } from "../../engine/schema";
import { ChoicesEditor } from "./ChoicesEditor";
import { ClozeField } from "./ClozeField";
import { ItemsEditor } from "./ItemsEditor";
import { MarkdownField } from "./MarkdownField";

/** 카드는 JSON 에서 그대로 올 수 있으니 값의 형태를 믿지 않는다. */
function asText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function FieldRenderer({
  spec,
  value,
  bad,
  onChange,
  onInsertImage,
}: {
  spec: FieldSpec;
  value: unknown;
  bad?: boolean;
  onChange: (value: string | string[]) => void;
  onInsertImage?: () => Promise<string | null>;
}) {
  return (
    <div className="field">
      <label className="field-label">
        {spec.label}
        {spec.required && <span className="req">*</span>}
      </label>
      {spec.hint && <p className="field-hint">{spec.hint}</p>}
      {spec.kind === "text" && (
        <input
          className={bad ? "input bad" : "input"}
          value={asText(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {spec.kind === "markdown" && (
        <MarkdownField
          value={asText(value)}
          rows={spec.rows}
          bad={bad}
          onChange={onChange}
          onInsertImage={onInsertImage}
        />
      )}
      {spec.kind === "cloze" && (
        <ClozeField value={asText(value)} rows={spec.rows} bad={bad} onChange={onChange} />
      )}
      {spec.kind === "items" && (
        <ItemsEditor
          value={Array.isArray(value) ? value.map(asText) : []}
          bad={bad}
          onChange={onChange}
        />
      )}
      {spec.kind === "choices" && (
        <ChoicesEditor value={Array.isArray(value) ? value.map(asText) : []} onChange={onChange} />
      )}
    </div>
  );
}

/**
 * 스킬 설치.
 *
 * 스킬 페이로드는 앱 바이너리 안에 있다 — 앱은 사용자의 스킬 디렉토리를 읽는 쪽이
 * 아니라 거기에 써 넣는 쪽이다. 설치본이 번들과 어긋난 파일까지 짚어 주므로
 * 손으로 고쳐 둔 스킬을 덮어쓰기 전에 알 수 있다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { HAS_TAURI, api, ask, dialogs, type SkillStatus } from "../lib/tauri";

type TargetKind = "user-claude" | "user-agents" | "project";

/** 목록이 길면 화면을 다 먹는다 — 앞 5개만 짚고 나머지는 수로 알린다. */
function FileList(props: { label: string; files: string[]; kind: "warn" | "err" }) {
  if (!props.files.length) return null;
  return (
    <div className={`diag ${props.kind}`}>
      <span className="diag-mark">{props.kind === "err" ? "✕" : "!"}</span>
      <div>
        {props.label} {props.files.length}개
        <div className="diag-why mono">
          {props.files.slice(0, 5).join(", ")}
          {props.files.length > 5 ? ` …외 ${props.files.length - 5}개` : ""}
        </div>
      </div>
    </div>
  );
}

export function SkillPanel(props: { onToast(msg: string, kind?: "ok" | "err"): void }) {
  const [kind, setKind] = useState<TargetKind>("user-claude");
  const [projectDir, setProjectDir] = useState("");
  const [status, setStatus] = useState<SkillStatus | null>(null);
  const [busy, setBusy] = useState(false);

  /* onToast 는 호출부가 인라인으로 넘길 수 있다 — 참조가 바뀔 때마다 다시 조회하지 않게 ref 로 든다. */
  const toast = useRef(props.onToast);
  toast.current = props.onToast;

  const root = kind === "project" ? (projectDir ? `claude:${projectDir}` : "") : kind;

  const refresh = useCallback(async (target: string) => {
    if (!HAS_TAURI || !target) {
      setStatus(null);
      return;
    }
    try {
      setStatus(await api.skillStatus(target));
    } catch (e) {
      setStatus(null);
      toast.current(String(e), "err");
    }
  }, []);

  useEffect(() => {
    void refresh(root);
  }, [refresh, root]);

  const run = async (fn: (target: string) => Promise<SkillStatus>, done: string) => {
    setBusy(true);
    try {
      setStatus(await fn(root));
      toast.current(done, "ok");
    } catch (e) {
      toast.current(String(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      const dir = await dialogs.pickFolder();
      if (dir) setProjectDir(dir);
    } catch (e) {
      toast.current(String(e), "err");
    }
  };

  const remove = async () => {
    const ok = await ask(
      `${status?.target ?? root} 의 flashcards 스킬을 지운다. 손으로 고친 내용도 함께 사라진다.`,
      "스킬 제거",
    );
    if (ok) await run(api.skillRemove, "스킬을 지웠다");
  };

  const off = !HAS_TAURI || busy || !root;

  return (
    <div className="panel-body">
      <div className="field">
        <label className="field-label">설치 대상</label>
        <select
          className="select"
          value={kind}
          disabled={!HAS_TAURI}
          onChange={(e) => setKind(e.target.value as TargetKind)}
        >
          <option value="user-claude">~/.claude/skills — Claude Code</option>
          <option value="user-agents">~/.agents/skills — 공용 에이전트</option>
          <option value="project">프로젝트 폴더 고르기</option>
        </select>
        {kind === "project" ? (
          <div className="row tight">
            <button type="button" className="btn sm" disabled={!HAS_TAURI} onClick={() => void pick()}>
              폴더 고르기
            </button>
            <span className="mono muted">{projectDir || "고르지 않았다"}</span>
          </div>
        ) : null}
        {!HAS_TAURI ? (
          <div className="field-hint">데스크톱 앱에서만 설치할 수 있다.</div>
        ) : null}
      </div>

      {status ? (
        <>
          <div className="field">
            <label className="field-label">설치 위치</label>
            <div className="mono">{status.target}</div>
          </div>

          <div className="row tight">
            <span className={status.installed ? "badge ok" : "badge mute"}>
              {status.installed ? "설치됨" : "설치 안 됨"}
            </span>
            {status.installed ? (
              <span className={status.up_to_date ? "badge ok" : "badge warn"}>
                {status.up_to_date ? "최신" : "번들과 다르다"}
              </span>
            ) : null}
            <span className="badge mute">번들 {status.bundled_files}개 파일</span>
            <span className="badge mute">번들 v{status.bundled_version}</span>
            {status.installed ? (
              <span className="badge mute">설치 v{status.installed_version ?? "?"}</span>
            ) : null}
          </div>

          <FileList label="번들에만 있다(설치되지 않았다)" files={status.missing} kind="warn" />
          <FileList label="내용이 다르다(덮어쓰면 사라진다)" files={status.differing} kind="err" />
          <FileList label="설치본에만 있다" files={status.extra} kind="warn" />
        </>
      ) : (
        <div className="list-empty">
          {HAS_TAURI ? "설치 상태를 읽지 못했다." : "브라우저에서는 설치 상태를 읽을 수 없다."}
        </div>
      )}

      <div className="row tight">
        <button
          type="button"
          className="btn primary"
          disabled={off}
          onClick={() => void run(api.skillInstall, "스킬을 설치했다")}
        >
          {status?.installed ? "갱신" : "설치"}
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={off || !status?.installed}
          onClick={() => void remove()}
        >
          제거
        </button>
        <span className="spacer" />
        <button type="button" className="btn ghost sm" disabled={off} onClick={() => void refresh(root)}>
          상태 새로 읽기
        </button>
      </div>
    </div>
  );
}

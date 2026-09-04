/**
 * 최근 파일 — `<appDataDir>/recent.json` 에 경로 문자열 배열, 최신이 앞, 최대 10개.
 *
 * 열기·저장·다른 이름으로가 성공한 경로만 넣는다. 지워진 파일은 목록을 펼치는 순간
 * `fileExists` 로 걸러 저장한다 — 눌러 보고 "없다" 는 소리를 듣게 하지 않는다.
 * 브라우저 모드에는 경로가 없으므로 기능 자체가 없다(빈 목록).
 */
import { HAS_TAURI, api, appDataPath } from "./tauri";

const FILE = "recent.json";
const MAX = 10;

async function load(): Promise<string[]> {
  const file = await appDataPath(FILE);
  if (!(await api.fileExists(file))) return [];
  try {
    const v: unknown = JSON.parse(await api.readText(file));
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string" && p !== "") : [];
  } catch {
    return [];
  }
}

async function store(paths: string[]): Promise<string[]> {
  await api.writeText(await appDataPath(FILE), JSON.stringify(paths, null, 2) + "\n");
  return paths;
}

export const recent = {
  list(): Promise<string[]> {
    return HAS_TAURI ? load() : Promise.resolve([]);
  },

  /** 맨 앞에 넣는다. 이미 있으면 그 자리에서 빼 앞으로 — 중복 없이 최근 순서를 지킨다. */
  async add(path: string): Promise<string[]> {
    if (!HAS_TAURI) return [];
    const rest = (await load()).filter((p) => p !== path);
    return store([path, ...rest].slice(0, MAX));
  },

  /** 없는 파일을 걸러낸 목록. 걸러진 것이 있으면 저장까지 한다. */
  async prune(): Promise<string[]> {
    if (!HAS_TAURI) return [];
    const all = await load();
    const alive = await Promise.all(all.map((p) => api.fileExists(p).catch(() => false)));
    const kept = all.filter((_, i) => alive[i]);
    return kept.length === all.length ? kept : store(kept);
  },
};

import { parseJson, type RepoRow } from "./db";

/** True when the session user owns the repo (GitHub id or login) or is listed in the file's maintainers. */
export function isOwnerOf(repo: RepoRow, login: string | undefined, userId: number | undefined): boolean {
  if (!login) return false;
  if (repo.owner_id != null && userId === repo.owner_id) return true;
  if (repo.owner.toLowerCase() === login.toLowerCase() && repo.owner_type !== "Organization") return true;
  const meta = parseJson<{ maintainers?: string[] }>(repo.meta, {});
  return (meta.maintainers ?? []).map((m) => m.toLowerCase()).includes(login.toLowerCase());
}

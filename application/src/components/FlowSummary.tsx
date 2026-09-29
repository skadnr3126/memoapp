import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "../storage/repository";
import { flowSummaryInput } from "../flowSummary";

type Prepared = { workspaceRoot: string; input: ReturnType<typeof flowSummaryInput> };
const keyError = (error: unknown) => String(error).includes("OPENROUTER_KEY_");

type Summary = { path: string; markdown: string };
const cache = new Map<string, Summary | null>();
const pending = new Map<string, Promise<Summary | null>>();

export function FlowSummary({ prepare, workspaceRoot, flowId }: { prepare: () => Promise<Prepared>; workspaceRoot: string; flowId: string }) {
  const cacheKey = JSON.stringify([workspaceRoot, flowId]);
  const running = useRef(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [result, setResult] = useState<Summary | null>(() => cache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const request = pending.get(cacheKey) ?? (cache.has(cacheKey) ? Promise.resolve(cache.get(cacheKey) ?? null) :
      invoke<Summary | null>("load_flow_summary", { workspaceRoot, flowId }));
    pending.set(cacheKey, request);
    void request.then(value => {
      cache.set(cacheKey, value);
      if (!cancelled) setResult(value);
    }).catch(error => { if (!cancelled) setError(String(error)); }).finally(() => {
      if (pending.get(cacheKey) === request) pending.delete(cacheKey);
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey, workspaceRoot, flowId]);

  const runSummary = async () => {
    setStatus("편집 내용과 파일 저장을 확인하는 중…");
    const prepared = await prepare();
    setStatus("OpenRouter로 Flow를 요약하는 중…");
    if (prepared.workspaceRoot !== workspaceRoot || prepared.input.id !== flowId) throw new Error("Flow가 변경되었습니다. 다시 시도하세요.");
    const request = invoke<Summary>("summarize_flow", prepared);
    pending.set(cacheKey, request);
    try {
      const value = await request;
      cache.set(cacheKey, value);
      setResult(value);
    } finally { if (pending.get(cacheKey) === request) pending.delete(cacheKey); }
    setStatus("요약 파일을 저장했습니다.");
  };
  const summarize = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      if (!await invoke<boolean>("has_openrouter_api_key")) { setNeedsKey(true); setStatus(""); return; }
      setOpen(false);
      await runSummary();
    } catch (error) {
      if (keyError(error)) setNeedsKey(true);
      setError(String(error).replace(/^OPENROUTER_KEY_(?:REQUIRED|INVALID):/, "")); setStatus("");
    } finally { running.current = false; setBusy(false); }
  };
  const close = () => { setOpen(false); setNeedsKey(false); setApiKey(""); setError(""); };
  const deleteKey = async () => {
    setBusy(true); setError("");
    try {
      await invoke("delete_openrouter_api_key");
      setNeedsKey(true); setStatus("저장된 API 키를 삭제했습니다.");
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const registerKey = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setStatus("OpenRouter API 키를 확인하는 중…");
    try {
      await invoke("save_openrouter_api_key", { apiKey });
      setApiKey(""); setNeedsKey(false); setOpen(false);
      await runSummary();
    } catch (error) {
      setError(String(error).replace(/^OPENROUTER_KEY_INVALID:/, "")); setStatus("");
    } finally { setBusy(false); }
  };
  return <section className="flow-summary" aria-label="Flow 요약">
    <button className="button" disabled={busy || loading || !isDesktopRuntime()} onClick={() => { setOpen(true); setError(""); }}>{loading ? "요약 불러오는 중…" : result ? "다시 요약" : "이 Flow 요약"}</button>
    {status && <span role="status" className="flow-summary-status">{status}</span>}
    {open && <div className="flow-summary-key" role="dialog" aria-label="Flow 요약 확인">
      <button type="button" className="flow-summary-close" aria-label="닫기" disabled={busy} onClick={close}>×</button>
      {!needsKey && <>
        <p>{result ? "다시 요약하면 기존 요약이 교체됩니다. 진행할까요?" : "이 Flow를 OpenRouter로 요약할까요?"}</p>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void summarize()}>요약하기</button>
        <button type="button" className="button" disabled={busy} onClick={() => void deleteKey()}>저장된 API 키 삭제</button>
      </>}
    {needsKey && <form onSubmit={event => void registerKey(event)}>
      <label htmlFor="openrouter-api-key">OpenRouter API 키</label>
      <input id="openrouter-api-key" type="password" autoComplete="off" value={apiKey} onChange={event => setApiKey(event.target.value)} required autoFocus />
      <button className="button button-primary" disabled={busy}>등록하고 요약</button>
      <small>키는 Windows 자격 증명 관리자에 저장됩니다. 무료 모델 라우터를 사용합니다.</small>
      {error && <span className="flow-summary-key-error" role="alert">등록 실패: {error}</span>}
    </form>}
    {error && !needsKey && <p className="flow-summary-key-error" role="alert">{error}</p>}
    </div>}
    {error && !open && <p className="flow-summary-error" role="alert">요약 실패: {error}</p>}
    {result && <details className="flow-summary-result">
      <summary>요약 Markdown 보기</summary>
      <p>{result.path}</p>
      <pre>{result.markdown}</pre>
    </details>}
  </section>;
}

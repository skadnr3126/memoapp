import { expect, type Locator, type Page } from "@playwright/test";
import type { snapshotFor } from "../src/storage/repository";
import type { EditorSession } from "../src/editorProtocol";

type Snapshot = ReturnType<typeof snapshotFor>;
type Session = { openWorkspaceRoots: string[]; activeWorkspaceRoot: string | null };
type InvokeArgs = {
  workspaceRoot?: string; snapshot?: Snapshot; session?: Session;
  sourceRoot?: string; targetRoot?: string; flowId?: string;
  handler?: number; event?: string; eventId?: number;
  preferences?: { sidebarWidth?: number; sidebarCollapsed?: boolean };
  payload?: EditorSession & { requestId?: string; suspend?: boolean };
};

export async function installNativeFlowMock(page: Page) {
  await page.addInitScript(() => {
    let callbackId = 0;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let editorSession: EditorSession | undefined;
    const publish = (event: string, payload: unknown) => {
      for (const [id, listener] of listeners) {
        if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
      }
    };
    const emptySnapshot = (): Snapshot => ({
      blockFiles: [], flowFiles: [], workspace: '{"version":1}',
      layout: '{"version":2,"nodePositionsByFlow":{},"viewportByFlow":{}}',
    });
    const load = (root: string): Snapshot => JSON.parse(localStorage.getItem(`test-workspace:${root}`) ?? JSON.stringify(emptySnapshot()));
    const save = (root: string, snapshot: Snapshot) => localStorage.setItem(`test-workspace:${root}`, JSON.stringify(snapshot));
    const record = (command: string) => {
      const commands: string[] = JSON.parse(localStorage.getItem("test-command-log") ?? "[]");
      commands.push(command); localStorage.setItem("test-command-log", JSON.stringify(commands));
    };
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback(callback: (event: unknown) => void) { callbacks.set(++callbackId, callback); return callbackId; },
        unregisterCallback(id: number) { callbacks.delete(id); },
        async invoke(command: string, args: InvokeArgs = {}) {
          if (command === "independent_workspace_root") return "D:/Library";
          if (command === "recent_workspaces") return ["D:/A", "D:/B"];
          if (command === "workspace_session") {
            if (args.session) localStorage.setItem("test-workspace-session", JSON.stringify(args.session));
            return JSON.parse(localStorage.getItem("test-workspace-session") ?? '{"openWorkspaceRoots":[],"activeWorkspaceRoot":null}');
          }
          if (command === "resolve_workspace_root") {
            if (args.workspaceRoot === "D:/missing") throw new Error("작업공간 폴더가 존재하지 않습니다.");
            return args.workspaceRoot;
          }
          if (command === "plugin:window|get_all_windows") return ["main", "editor"];
          if (command === "plugin:event|listen" && args.event && args.handler) {
            const id = ++callbackId;
            listeners.set(id, { event: args.event, handler: args.handler });
            if (args.event === "editor:ready") setTimeout(() => publish("editor:ready", undefined), 0);
            return id;
          }
          if (command === "plugin:event|unlisten" && args.eventId) { listeners.delete(args.eventId); return; }
          if (command === "plugin:event|emit_to") {
            if (args.event === "editor:load") editorSession = args.payload;
            if (args.event === "editor:clear") editorSession = undefined;
            if (args.event === "editor:flush") {
              record(args.payload?.suspend ? "editor:flush:suspend" : "editor:flush");
              const markdown = localStorage.getItem("test-pending-editor-markdown");
              if (markdown !== null && editorSession) {
                publish("editor:save", { ...editorSession, markdown });
                localStorage.removeItem("test-pending-editor-markdown");
              }
              publish("editor:flushed", { requestId: args.payload?.requestId });
            }
            return;
          }
          if (command === "plugin:dialog|open") return "D:/B";
          if (command === "load_ui_preferences") {
            record(command);
            return JSON.parse(localStorage.getItem("test-ui-preferences") ?? '{"sidebarWidth":292,"sidebarCollapsed":false}');
          }
          if (command === "save_ui_preferences") { localStorage.setItem("test-ui-preferences", JSON.stringify(args.preferences)); return; }
          if (command === "restore_editor_preferences") { record(command); return; }
          if (command === "load_flow_summary") return null;
          if (command === "open_workspace" && args.workspaceRoot) return { workspaceRoot: args.workspaceRoot, ...load(args.workspaceRoot) };
          if (command === "save_workspace_snapshot" && args.workspaceRoot && args.snapshot) {
            record(`save:${args.workspaceRoot}`); save(args.workspaceRoot, args.snapshot); return;
          }
          if (command === "move_flow" && args.sourceRoot && args.targetRoot && args.flowId) {
            record("move_flow");
            await new Promise(resolve => setTimeout(resolve, Number(localStorage.getItem("test-move-delay") ?? "0")));
            if (localStorage.getItem("test-move-fail")) throw new Error("파일 이동을 완료하지 못했습니다.");
            const source = load(args.sourceRoot); const target = load(args.targetRoot);
            const prefix = `flows/${args.flowId}/`;
            const flowFiles = source.flowFiles.filter(file => file.relativePath.startsWith(prefix));
            if (!flowFiles.some(file => file.relativePath.endsWith("/flow.json"))) throw new Error("이동할 플로우가 없습니다.");
            if (target.flowFiles.some(file => file.relativePath.startsWith(prefix))) throw new Error("같은 ID의 플로우가 있습니다.");
            target.flowFiles.push(...flowFiles); target.blockFiles.push(...source.blockFiles.filter(file => file.relativePath.startsWith(prefix)));
            source.flowFiles = source.flowFiles.filter(file => !file.relativePath.startsWith(prefix));
            source.blockFiles = source.blockFiles.filter(file => !file.relativePath.startsWith(prefix));
            const sourceLayout: { version: number; nodePositionsByFlow: Record<string, unknown>; viewportByFlow: Record<string, unknown> } = JSON.parse(source.layout);
            delete sourceLayout.nodePositionsByFlow[args.flowId]; delete sourceLayout.viewportByFlow[args.flowId];
            source.layout = JSON.stringify(sourceLayout);
            const remaining = source.flowFiles.find(file => file.relativePath.endsWith("/flow.json"));
            source.workspace = JSON.stringify({ version: 1, activeFlowId: remaining ? JSON.parse(remaining.content).id : undefined });
            target.workspace = JSON.stringify({ version: 1, activeFlowId: args.flowId });
            save(args.sourceRoot, source); save(args.targetRoot, target); return;
          }
        },
      },
    });
  });
}

export async function addWorkspace(page: Page, root: "D:/A" | "D:/B") {
  await page.getByRole("button", { name: "작업공간 추가하기", exact: true }).click();
  await page.getByRole("region", { name: "작업공간 추가", exact: true }).getByRole("button", { name: root, exact: true }).click();
  await expect(page.locator(`.workspace-tab button[title="${root}"]`)).toHaveAttribute("aria-current", "page");
}

export async function dragFlow(page: Page, source: Locator, target: Locator) {
  const start = await source.boundingBox(); const end = await target.boundingBox();
  if (!start || !end) throw new Error("플로우 또는 이동 대상이 보이지 않습니다.");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + 20, end.y + 18, { steps: 12 });
  await page.mouse.up();
}

export async function savedSnapshot(page: Page, root: string): Promise<Snapshot> {
  return page.evaluate(root => JSON.parse(localStorage.getItem(`test-workspace:${root}`) ?? "null"), root);
}

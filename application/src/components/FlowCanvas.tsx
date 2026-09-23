import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BlockId, Flow, getDisplayTitle, WorkspaceState } from "../domain/flow";
import { ConnectionState } from "../domain/connection";
import { defaultPosition, linkPath, NODE_WIDTH, NODE_HEIGHT, resizeNode, type Point, type ResizeCorner } from "../domain/layout";

export type NodePosition = Point;
type PointerDrag = {
  blockIds: BlockId[];
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  scrollLeft: number;
  scrollTop: number;
  positions: Record<BlockId, NodePosition>;
  origin: NodePosition;
  moved: boolean;
};
type PanDrag = { startX: number; startY: number; scrollLeft: number; scrollTop: number };
type SelectionDrag = { startX: number; startY: number; currentX: number; currentY: number };
type Bounds = { left: number; top: number; right: number; bottom: number };

export const getPannedScroll = (drag: PanDrag, pointerX: number, pointerY: number) => ({
  left: drag.scrollLeft - (pointerX - drag.startX),
  top: drag.scrollTop - (pointerY - drag.startY),
});

export const boundsOverlap = (first: Bounds, second: Bounds) =>
  first.left <= second.right && first.right >= second.left && first.top <= second.bottom && first.bottom >= second.top;

export const getAutoScrollDelta = (pointer: number, start: number, end: number, edge = 48) => {
  if (pointer < start + edge) return -Math.min(18, Math.max(4, start + edge - pointer));
  if (pointer > end - edge) return Math.min(18, Math.max(4, pointer - (end - edge)));
  return 0;
};

export const clampScroll = (position: number, maximum: number) => Math.max(0, Math.min(maximum, position));

export const centerNodeAt = ({ x, y, width, height }: NodePosition): NodePosition => ({ x: x - (width ?? NODE_WIDTH) / 2, y: y - (height ?? NODE_HEIGHT) / 2 });

export const keepNodeInside = (point: NodePosition, canvasWidth: number, canvasHeight: number, nodeHeight = NODE_HEIGHT): NodePosition => {
  const width = Math.min(point.width ?? NODE_WIDTH, canvasWidth);
  const height = Math.min(point.height ?? nodeHeight, canvasHeight);
  return {
    ...point,
    x: Math.max(0, Math.min(point.x, canvasWidth - width)),
    y: Math.max(0, Math.min(point.y, canvasHeight - height)),
    ...(width !== (point.width ?? NODE_WIDTH) ? { width } : {}),
    ...(height !== (point.height ?? nodeHeight) ? { height } : {}),
  };
};

/** Finds the most natural neighboring node in the requested direction. */
export const findDirectionalNeighbor = (
  currentId: BlockId,
  direction: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  positions: Record<BlockId, NodePosition>,
  ids: BlockId[],
  heights: Record<BlockId, number> = {},
) => {
  const current = positions[currentId];
  if (!current) return undefined;
  const cx = current.x + (current.width ?? NODE_WIDTH) / 2;
  const cy = current.y + (heights[currentId] ?? NODE_HEIGHT) / 2;
  const candidates = ids.filter((id) => {
    if (id === currentId || !positions[id]) return false;
    const p = positions[id];
    const x = p.x + (p.width ?? NODE_WIDTH) / 2, y = p.y + (heights[id] ?? NODE_HEIGHT) / 2;
    return direction === "ArrowRight" ? x > cx : direction === "ArrowLeft" ? x < cx : direction === "ArrowDown" ? y > cy : y < cy;
  });
  if (!candidates.length) return undefined;
  const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
  return candidates.sort((a, b) => {
    const pa = positions[a], pb = positions[b];
    const ax = pa.x + (pa.width ?? NODE_WIDTH) / 2, ay = pa.y + (heights[a] ?? NODE_HEIGHT) / 2;
    const bx = pb.x + (pb.width ?? NODE_WIDTH) / 2, by = pb.y + (heights[b] ?? NODE_HEIGHT) / 2;
    const ap = horizontal ? Math.abs(ax - cx) : Math.abs(ay - cy);
    const ao = horizontal ? Math.abs(ay - cy) : Math.abs(ax - cx);
    const bp = horizontal ? Math.abs(bx - cx) : Math.abs(by - cy);
    const bo = horizontal ? Math.abs(by - cy) : Math.abs(bx - cx);
    return (ap + ao * 1.35) - (bp + bo * 1.35);
  })[0];
};

type FlowCanvasProps = {
  workspace: WorkspaceState;
  flow: Flow;
  onOpenBlock: (blockId: BlockId, focus?: boolean) => void;
  onRenameBlock: (blockId: BlockId, title: string) => void;
  nodePositions: Record<BlockId, NodePosition | undefined>;
  selectedBlockIds: BlockId[];
  onSelectedBlockIdsChange: (blockIds: BlockId[]) => void;
  onNodePositionsChange: (positions: Record<BlockId, NodePosition>) => void;
  connection: ConnectionState;
  onChooseConnectionBlock: (id: BlockId) => void;
  selectedLinkId?: string;
  onSelectLink: (id: string) => void;
  onCreateBlock?: (position: NodePosition) => void;
  onPointerBlockPositionChange?: (position?: NodePosition) => void;
  onDeleteBlock?: (id: BlockId) => void;
  onDeleteLink?: (id: string) => void;
  onBeginConnection?: (id: BlockId) => void;
};

export function FlowCanvas({
  workspace,
  flow,
  onOpenBlock,
  onRenameBlock,
  nodePositions,
  selectedBlockIds,
  onSelectedBlockIdsChange,
  onNodePositionsChange,
  connection, onChooseConnectionBlock, selectedLinkId, onSelectLink, onCreateBlock, onPointerBlockPositionChange, onDeleteBlock, onDeleteLink, onBeginConnection,
}: FlowCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeElementsRef = useRef(new Map<BlockId, HTMLElement>());
  const pointerDragRef = useRef<PointerDrag | undefined>(undefined);
  const resizeRef = useRef<{ id: string; corner: ResizeCorner; x: number; y: number; rect: Required<Point> } | undefined>(undefined);
  const panDragRef = useRef<(PanDrag & { moved: boolean; blockId?: BlockId; linkId?: string }) | undefined>(undefined);
  const mouseRef = useRef<NodePosition | undefined>(undefined);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; position: NodePosition; blockId?: BlockId; linkId?: string }>();
  const selectionDragRef = useRef<SelectionDrag | undefined>(undefined);
  const autoScrollPointerRef = useRef<NodePosition | undefined>(undefined);
  const autoScrollFrameRef = useRef<number | undefined>(undefined);
  const autoScrollLimitRef = useRef<NodePosition | undefined>(undefined);
  const suppressClickRef = useRef(false);
  const [selectionDrag, setSelectionDrag] = useState<SelectionDrag>();
  const [summaryDraft, setSummaryDraft] = useState("");
  const [editingId, setEditingId] = useState<BlockId>();
  const [heights, setHeights] = useState<Record<BlockId, number>>({});
  const keepPositionsInside = (next: Record<BlockId, NodePosition>) => {
    const canvas = canvasRef.current;
    if (!canvas) return next;
    return Object.fromEntries(Object.entries(next).map(([id, point]) => [id, keepNodeInside(point, canvas.clientWidth, canvas.clientHeight, heights[id])]));
  };
  const updatePositions = (next: Record<BlockId, NodePosition>) => onNodePositionsChange(keepPositionsInside(next));
  useLayoutEffect(() => {
    const measure = () => {
      const next = Object.fromEntries([...nodeElementsRef.current].map(([id, element]) => [id, element.getBoundingClientRect().height || NODE_HEIGHT]));
      setHeights(current => Object.keys(next).length === Object.keys(current).length && Object.entries(next).every(([id, height]) => current[id] === height) ? current : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    nodeElementsRef.current.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [flow.blockIds]);
  const selectedBlockIdSet = useMemo(() => new Set(selectedBlockIds), [selectedBlockIds]);
  const linking = connection.kind !== "idle";
  const worldPosition = (x: number, y: number) => {
    const bounds = canvasRef.current!.getBoundingClientRect();
    return { x: x - bounds.left + originRef.current.x, y: y - bounds.top + originRef.current.y };
  };
  const pointerBlockPosition = (x: number, y: number) => centerNodeAt(worldPosition(x, y));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(undefined);
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.key.toLowerCase() !== "t") return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      const pointer = mouseRef.current;
      if (!pointer) return;
      event.preventDefault();
      if (event.repeat || event.isComposing || linking || panDragRef.current || pointerDragRef.current || selectionDragRef.current) return;
      setMenu(undefined);
      onCreateBlock?.(pointerBlockPosition(pointer.x, pointer.y));
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(undefined);
    };
    const blur = () => { setMenu(undefined); mouseRef.current = undefined; onPointerBlockPositionChange?.(); panDragRef.current = undefined; viewportRef.current?.classList.remove("is-panning"); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("blur", blur);
    };
  }, [onCreateBlock, onPointerBlockPositionChange, linking]);
  useEffect(() => { setMenu(undefined); setEditingId(undefined); }, [flow.id, linking]);
  useEffect(() => { if (menu?.linkId && !flow.links.has(menu.linkId)) setMenu(undefined); }, [flow.links, menu]);
  useEffect(() => { if (menu) menuRef.current?.querySelector("button")?.focus(); }, [menu]);
  const positions = Object.fromEntries(flow.blockIds.map((id, index) => [id, nodePositions[id] ?? defaultPosition(index)]));
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const fitted = keepPositionsInside(positions);
      const changed = Object.fromEntries(Object.entries(fitted).filter(([id, point]) => JSON.stringify(point) !== JSON.stringify(positions[id])));
      if (Object.keys(changed).length) onNodePositionsChange(changed);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [positions, heights, onNodePositionsChange]);
  const origin = { x: 0, y: 0 };
  const screenPosition = (id: string) => ({ ...positions[id], x: positions[id].x - origin.x, y: positions[id].y - origin.y });
  const pathBetween = (a: string, b: string) => linkPath(screenPosition(a), screenPosition(b), heights[a], heights[b]);
  const originRef = useRef(origin);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) { viewport.scrollLeft += originRef.current.x - origin.x; viewport.scrollTop += originRef.current.y - origin.y; }
    originRef.current = origin;
  }, [origin.x, origin.y]);

  const finishPanning = (viewport: HTMLDivElement, pointerId: number) => {
    if (!panDragRef.current) return;
    if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
    panDragRef.current = undefined;
    viewport.classList.remove("is-panning");
  };

  const updateDraggedBlocks = (drag: PointerDrag) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const x = drag.currentX - drag.startX + viewport.scrollLeft - drag.scrollLeft + originRef.current.x - drag.origin.x;
    const y = drag.currentY - drag.startY + viewport.scrollTop - drag.scrollTop + originRef.current.y - drag.origin.y;
    if (Math.abs(x) > 3 || Math.abs(y) > 3) drag.moved = true;
    updatePositions(Object.fromEntries(drag.blockIds.map((id) => [id, { ...drag.positions[id], x: drag.positions[id].x + x, y: drag.positions[id].y + y }])));
  };

  const updateSelectionDrag = (clientX: number, clientY: number) => {
    const drag = selectionDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const next = { ...drag, currentX: clientX - bounds.left, currentY: clientY - bounds.top };
    selectionDragRef.current = next;
    setSelectionDrag(next);
  };

  const stopAutoScroll = () => {
    autoScrollPointerRef.current = undefined;
    autoScrollLimitRef.current = undefined;
    if (autoScrollFrameRef.current !== undefined) window.cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = undefined;
  };

  const autoScroll = () => {
    const pointer = autoScrollPointerRef.current;
    const viewport = viewportRef.current;
    if (!pointer || !viewport) {
      autoScrollFrameRef.current = undefined;
      return;
    }
    const bounds = viewport.getBoundingClientRect();
    const left = getAutoScrollDelta(pointer.x, bounds.left, bounds.right);
    const top = getAutoScrollDelta(pointer.y, bounds.top, bounds.bottom);
    if (!left && !top) {
      autoScrollFrameRef.current = undefined;
      return;
    }
    const limit = autoScrollLimitRef.current ?? { x: viewport.scrollWidth - viewport.clientWidth, y: viewport.scrollHeight - viewport.clientHeight };
    const nextLeft = clampScroll(viewport.scrollLeft + left, limit.x);
    const nextTop = clampScroll(viewport.scrollTop + top, limit.y);
    if (nextLeft === viewport.scrollLeft && nextTop === viewport.scrollTop) {
      autoScrollFrameRef.current = undefined;
      return;
    }
    viewport.scrollTo({ left: nextLeft, top: nextTop });
    updateSelectionDrag(pointer.x, pointer.y);
    if (pointerDragRef.current) updateDraggedBlocks(pointerDragRef.current);
    autoScrollFrameRef.current = window.requestAnimationFrame(autoScroll);
  };

  const startAutoScroll = (clientX: number, clientY: number) => {
    autoScrollPointerRef.current = { x: clientX, y: clientY };
    if (autoScrollFrameRef.current === undefined) autoScrollFrameRef.current = window.requestAnimationFrame(autoScroll);
  };

  const setAutoScrollLimit = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    autoScrollLimitRef.current = {
      x: viewport.scrollWidth - viewport.clientWidth,
      y: viewport.scrollHeight - viewport.clientHeight,
    };
  };

  useEffect(() => () => stopAutoScroll(), []);

  const finishSelecting = (canvas: HTMLDivElement, pointerId: number, shouldSelect = true) => {
    const drag = selectionDragRef.current;
    if (!drag) return;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    stopAutoScroll();
    selectionDragRef.current = undefined;
    setSelectionDrag(undefined);
    if (!shouldSelect) return;

    const canvasBounds = canvas.getBoundingClientRect();
    const selection: Bounds = {
      left: canvasBounds.left + Math.min(drag.startX, drag.currentX),
      top: canvasBounds.top + Math.min(drag.startY, drag.currentY),
      right: canvasBounds.left + Math.max(drag.startX, drag.currentX),
      bottom: canvasBounds.top + Math.max(drag.startY, drag.currentY),
    };
    onSelectedBlockIdsChange([...nodeElementsRef.current.entries()]
      .filter(([, element]) => {
        const bounds = element.getBoundingClientRect();
        return boundsOverlap(selection, bounds);
      })
      .map(([blockId]) => blockId));
  };

  const selectionStyle = selectionDrag
    ? {
        left: Math.min(selectionDrag.startX, selectionDrag.currentX),
        top: Math.min(selectionDrag.startY, selectionDrag.currentY),
        width: Math.abs(selectionDrag.currentX - selectionDrag.startX),
        height: Math.abs(selectionDrag.currentY - selectionDrag.startY),
      }
    : undefined;

  const activate = (id: BlockId, focus = false) => {
    if (linking) onChooseConnectionBlock(id);
    else { onSelectedBlockIdsChange([id]); onOpenBlock(id, focus); }
  };
  return (
    <div className="flow-canvas-scroll" ref={viewportRef} onContextMenu={(e) => e.preventDefault()}
      onPointerEnter={(e) => { mouseRef.current = { x: e.clientX, y: e.clientY }; onPointerBlockPositionChange?.(worldPosition(e.clientX, e.clientY)); }}
      onPointerLeave={() => { mouseRef.current = undefined; onPointerBlockPositionChange?.(); }}
      onScroll={() => setMenu(undefined)}
      onPointerDown={(e) => {
        if (e.target instanceof Element && e.target.closest(".canvas-context-menu")) return;
        if (e.button !== 2) return;
        e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
        const target = e.target instanceof Element ? e.target : undefined;
        const blockId = target?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
        const linkId = target?.closest("[data-link-id]")?.getAttribute("data-link-id") ?? undefined;
        panDragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: e.currentTarget.scrollLeft, scrollTop: e.currentTarget.scrollTop, moved: false, blockId, linkId };
      }}
      onPointerMove={(e) => {
        mouseRef.current = { x: e.clientX, y: e.clientY }; onPointerBlockPositionChange?.(worldPosition(e.clientX, e.clientY));
        const drag = panDragRef.current;
        if (!drag) return;
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) drag.moved = true;
        if (drag.moved) {
          e.currentTarget.classList.add("is-panning");
          const next = getPannedScroll(drag, e.clientX, e.clientY);
          e.currentTarget.scrollLeft = next.left; e.currentTarget.scrollTop = next.top;
        }
      }}
      onPointerUp={(e) => {
        const drag = panDragRef.current;
        if (e.button !== 2 || !drag) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) <= 5 && !linking) {
          if (drag.blockId) onSelectedBlockIdsChange([drag.blockId]);
          if (drag.linkId) onSelectLink(drag.linkId);
          setMenu({ x: Math.max(0, Math.min(e.clientX, window.innerWidth - 190)), y: Math.max(0, Math.min(e.clientY, window.innerHeight - (drag.blockId ? 94 : 54))), position: pointerBlockPosition(drag.startX, drag.startY), blockId: drag.blockId, linkId: drag.linkId });
        }
        finishPanning(e.currentTarget, e.pointerId);
      }} onPointerCancel={(e) => finishPanning(e.currentTarget, e.pointerId)}
      onLostPointerCapture={(e) => finishPanning(e.currentTarget, e.pointerId)}>
      {menu && <div ref={menuRef} className="canvas-context-menu" role="menu" aria-label={menu.linkId ? "연결 작업" : menu.blockId ? "블록 작업" : "노드 생성"} style={{ left: menu.x, top: menu.y }}
        onPointerDown={(e) => e.stopPropagation()}>
        {menu.linkId ? <button role="menuitem" onClick={() => { onDeleteLink?.(menu.linkId!); setMenu(undefined); }}>연결 삭제 <span>Delete</span></button> : menu.blockId ? <>
          <button role="menuitem" onClick={() => { onBeginConnection?.(menu.blockId!); setMenu(undefined); }}>연결모드 진입 <span>Ctrl+D</span></button>
          <button role="menuitem" onClick={() => { onDeleteBlock?.(menu.blockId!); setMenu(undefined); }}>삭제 <span>Delete</span></button>
        </> : <button role="menuitem" onClick={() => { onCreateBlock?.(menu.position); setMenu(undefined); }}>새 노드 생성 <span>Ctrl+T</span></button>}
      </div>}
      <div className="flow-canvas graph-canvas" ref={canvasRef}
        onPointerDown={(e) => {
          if (linking || e.button !== 0 || (e.target instanceof Element && e.target.closest(".node-wrap, .link-hit"))) return;
          setEditingId(undefined);
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          onSelectedBlockIdsChange([]);
          e.preventDefault(); const bounds = e.currentTarget.getBoundingClientRect();
          const drag = { startX: e.clientX - bounds.left, startY: e.clientY - bounds.top, currentX: e.clientX - bounds.left, currentY: e.clientY - bounds.top };
          e.currentTarget.setPointerCapture(e.pointerId); setAutoScrollLimit(); selectionDragRef.current = drag; setSelectionDrag(drag);
        }}
        onPointerMove={(e) => { if (selectionDragRef.current) { updateSelectionDrag(e.clientX, e.clientY); startAutoScroll(e.clientX, e.clientY); } }}
        onPointerUp={(e) => finishSelecting(e.currentTarget, e.pointerId)} onPointerCancel={(e) => finishSelecting(e.currentTarget, e.pointerId, false)}>
        <svg className="connection-layer">
          {[...flow.links.values()].map((link) => {
            const d = pathBetween(link.source, link.target);
            return <g key={link.id}>
              <path d={d} className={selectedLinkId === link.id ? "is-selected" : ""} />
              {!linking && <path d={d} className="link-hit" data-link-id={link.id} role="button" tabIndex={0} aria-label={"연결 선택: " + getDisplayTitle(workspace.blocks.get(link.source)!) + " — " + getDisplayTitle(workspace.blocks.get(link.target)!)}
                onClick={(e) => { e.stopPropagation(); onSelectLink(link.id); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelectLink(link.id); } }} />}
            </g>;
          })}
          {connection.kind === "ready" && positions[connection.first] && positions[connection.second] &&
            <path className="link-preview" d={pathBetween(connection.first, connection.second)} />}
        </svg>
        {selectionStyle && <div className="selection-marquee" style={selectionStyle} aria-hidden="true" />}
        {!flow.blockIds.length && <p className="canvas-empty">빈 공간을 우클릭하거나 Ctrl+T로 첫 메모를 만드세요.</p>}
        {flow.blockIds.map((blockId) => {
          const block = workspace.blocks.get(blockId)!;
          const point = screenPosition(blockId);
          const first = connection.kind !== "idle" && connection.kind !== "first" && connection.first === blockId;
          const second = connection.kind === "ready" && connection.second === blockId;
          return <div className="node-wrap graph-node-wrap" data-block-id={blockId} style={{ left: point.x, top: point.y, width: point.width }} key={blockId}>
            <article ref={(element) => { if (element) nodeElementsRef.current.set(blockId, element); else nodeElementsRef.current.delete(blockId); }}
              style={{ height: point.height }}
              className={"flow-node" + (editingId === blockId ? " is-editing" : "") + (selectedBlockIdSet.has(blockId) ? " is-selected" : "") + (first ? " connection-first" : "") + (second ? " connection-second" : "")}
              role="button" tabIndex={0} aria-label={getDisplayTitle(block) + (linking ? " 연결 대상으로 선택" : " 편집")}
              onClick={(e) => { if (editingId !== blockId && !suppressClickRef.current) { e.currentTarget.focus(); activate(blockId); } }}
              onDoubleClick={() => { if (!linking) { activate(blockId, true); setSummaryDraft(block.title ?? ""); setEditingId(blockId); } }}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (!linking && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                  e.preventDefault();
                  const next = findDirectionalNeighbor(blockId, e.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", positions, flow.blockIds, heights);
                  if (next) {
                    const element = nodeElementsRef.current.get(next);
                    onSelectedBlockIdsChange([next]);
                    element?.focus();
                    element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
                    onOpenBlock(next);
                  }
                  return;
                }
                if (e.repeat) return;
                if (e.key === "Enter" || e.key === " ") {
                  if (connection.kind === "ready" && e.key === "Enter") return;
                  e.preventDefault(); e.stopPropagation(); activate(blockId, e.key === "Enter");
                  if (!linking && e.key === "Enter") { setSummaryDraft(block.title ?? ""); setEditingId(blockId); }
                }
              }}
              onPointerDown={(e) => {
                if (linking || e.button !== 0 || editingId === blockId) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                const blockIds = selectedBlockIdSet.has(blockId) ? selectedBlockIds : [blockId];
                if (!selectedBlockIdSet.has(blockId)) onSelectedBlockIdsChange(blockIds);
                setAutoScrollLimit();
                pointerDragRef.current = { blockIds, startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY,
                  scrollLeft: viewportRef.current?.scrollLeft ?? 0, scrollTop: viewportRef.current?.scrollTop ?? 0,
                  positions: Object.fromEntries(blockIds.map((id) => [id, positions[id]])), origin, moved: false };
              }}
              onPointerMove={(e) => { const drag = pointerDragRef.current; if (!drag || !drag.blockIds.includes(blockId)) return; drag.currentX = e.clientX; drag.currentY = e.clientY; updateDraggedBlocks(drag); startAutoScroll(e.clientX, e.clientY); }}
              onPointerUp={(e) => { const drag = pointerDragRef.current; if (drag?.moved) { suppressClickRef.current = true; window.setTimeout(() => { suppressClickRef.current = false; }, 0); } if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); pointerDragRef.current = undefined; stopAutoScroll(); }}
              onPointerCancel={() => { pointerDragRef.current = undefined; stopAutoScroll(); }}>
              <div className="node-summary">
                <div className={"node-summary-text" + (!block.title ? " is-placeholder" : "")} aria-hidden={editingId === blockId}>
                  {(editingId === blockId ? summaryDraft : block.title) ?? ""}{"\n"}
                </div>
                {editingId === blockId && <textarea autoFocus className="node-summary-input" defaultValue={block.title ?? ""}
                  aria-label="블록 요약 편집"
                  onFocus={e => {
                    const end = e.currentTarget.value.length;
                    e.currentTarget.setSelectionRange(end, end);
                  }}
                  onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
                  onChange={e => { setSummaryDraft(e.currentTarget.value); onRenameBlock(blockId, e.currentTarget.value); }}
                  onBlur={() => setEditingId(undefined)}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                      e.preventDefault(); setEditingId(undefined); nodeElementsRef.current.get(blockId)?.focus();
                    }
                  }} />}
              </div>
              {(first || second) && <span className="connection-order">{first ? "첫 번째" : "두 번째"}</span>}
            </article>
            {!linking && (["nw", "ne", "sw", "se"] as const).map(corner => <button key={corner} type="button"
              className={`node-resize node-resize-${corner}`} aria-label={`${corner} 모서리 크기 조절`}
              onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
              onPointerDown={e => {
                e.stopPropagation(); if (e.button !== 0) return;
                e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
                onSelectedBlockIdsChange([blockId]);
                resizeRef.current = { id: blockId, corner, x: e.clientX, y: e.clientY,
                  rect: { ...positions[blockId], width: point.width ?? NODE_WIDTH, height: heights[blockId] ?? NODE_HEIGHT } };
              }}
              onPointerMove={e => {
                const drag = resizeRef.current;
                if (!drag || drag.id !== blockId) return;
                updatePositions({ [blockId]: resizeNode(drag.rect, drag.corner, e.clientX - drag.x, e.clientY - drag.y) });
              }}
              onPointerUp={e => { resizeRef.current = undefined; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
              onPointerCancel={() => { resizeRef.current = undefined; }}
              onLostPointerCapture={() => { resizeRef.current = undefined; }}
              onKeyDown={e => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                e.preventDefault(); e.stopPropagation();
                updatePositions({ [blockId]: resizeNode({ ...positions[blockId], width: point.width ?? NODE_WIDTH, height: heights[blockId] ?? NODE_HEIGHT }, corner,
                  e.key === "ArrowLeft" ? -10 : e.key === "ArrowRight" ? 10 : 0, e.key === "ArrowUp" ? -10 : e.key === "ArrowDown" ? 10 : 0) });
              }} />)}
          </div>;
        })}
      </div>
    </div>
  );
}

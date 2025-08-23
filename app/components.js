'use client';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import ReactFlow, { ReactFlowProvider, addEdge, Handle, Position, useNodesState, useEdgesState } from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import {Node} from './node_types'; // Import the Node component


// Wrapper for ReactFlow custom nodes
const TaskGraphNode = React.memo(function TaskGraphNode({ id, data }) {
  return <Node id={id} data={data} />;
});

const nodeTypes = {
  taskGraphNode: TaskGraphNode,
};

// -----------------------------
// Graph Flow (ReactFlow + Dagre)
// -----------------------------

const nodeWidth = 200; // Match visual width from CSS (.rf-node)
const nodeHeight = 100;

/**
 * Run Dagre layout for the provided nodes/edges.
 * We compute positions for the full graph; cosmetic visibility is handled via node.hidden.
 */
// Compute layout and then enforce vertical ordering of siblings to match userData children order.
function getLayoutedElements(nodes, edges, userData, direction = 'LR') {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    const isRoot = node.id === 'root';
    dagreGraph.setNode(node.id, {
      width: isRoot ? 25 : (node.style?.width || nodeWidth),
      height: isRoot ? 25 : (node.style?.height || nodeHeight),
    });
  });
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  let layoutedNodes = nodes.map((node) => {
    const { x, y } = dagreGraph.node(node.id);
  const isRoot = node.id === 'root';
  const w = isRoot ? 25 : (node.style?.width || 200);
  const h = isRoot ? 25 : (node.style?.height || 36);
    return {
      ...node,
      targetPosition: direction === 'TB' ? 'top' : 'left',
      sourcePosition: direction === 'TB' ? 'bottom' : 'right',
      position: { x: x - w / 2, y: y - h / 2 },
    };
  });

  // Enforce child ordering vertically (top -> bottom) per parent's children list.
  // Only meaningful when direction === 'LR' (horizontal flow, vertical stacking of siblings).
  if (direction === 'LR' && userData) {
    const nodeMap = new Map(layoutedNodes.map((n) => [n.id, n]));
    const processedChildren = new Set();
    const SPACING = 150;

    Object.entries(userData).forEach(([parentId, info]) => {
      const children = info?.children || [];
      if (children.length < 2) return;
      // Filter to existing nodes only
      const childNodes = children.map((cid) => nodeMap.get(cid)).filter(Boolean);
      if (childNodes.length < 2) return;
      // Avoid reordering same nodes multiple times if they appear in multiple parent lists (shouldn't normally)
      const key = childNodes.map((c) => c.id).join('|');
      if (processedChildren.has(key)) return;
      processedChildren.add(key);

      // Determine anchor X (average) and starting Y (min current Y)
      const avgX = childNodes.reduce((sum, n) => sum + n.position.x, 0) / childNodes.length;
      let startY = Math.min(...childNodes.map((n) => n.position.y));

      childNodes.forEach((n, idx) => {
        n.position = { x: avgX, y: startY + idx * SPACING };
      });
    });
  }

  return { nodes: layoutedNodes, edges };
}

/** Build edges for rendering, respecting visibility on both source and target. */
function buildEdgesFrom(userData) {
  const edges = [];
  Object.entries(userData).forEach(([parent, info]) => {
    const parentVisible = info?.visible !== false;
    (info.children || []).forEach((child) => {
      const childInfo = userData[child];
      const childVisible = childInfo?.visible !== false;
      if (userData[child] && parentVisible && childVisible) {
        edges.push({
          id: `${parent}-${child}`,
          source: parent,
          target: child,
          animated: true,
        });
      }
    });
  });
  return edges;
}

/** Build edges ignoring visibility (used solely for Dagre layout). */
function buildEdgesForLayout(userData) {
  const edges = [];
  Object.entries(userData).forEach(([parent, info]) => {
    (info.children || []).forEach((child) => {
      if (userData[child]) {
        edges.push({
          id: `${parent}-${child}`,
          source: parent,
          target: child,
        });
      }
    });
  });
  return edges;
}

/**
 * FlowChart (controlled)
 * - Derives nodes/edges from userData
 * - Positions are computed with Dagre for the full graph (visibility ignored for layout)
 * - Cosmetic visibility via node.hidden; edges filter by visible ends
 * - Keyboard: Tab focuses first child; Backspace disabled in RF and handled here
 * - Selection reveals a node's direct children (visible=true)
 * - Dragging a node moves its entire subtree; drag-stop reorders siblings by Y
 */
export function FlowChart({ data: userData, setData: setUserData, isLoaded = true }) {
  // Local React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Run Dagre only once
  const didLayoutRef = useRef(false);
  // When creating a node, we can request selection after state sync
  const pendingSelectRef = useRef(null);
  // Initial positions to apply for freshly created nodes
  const pendingPositionsRef = useRef(new Map());

  /** Patch a single node's data inside React Flow state (keeps position). */
  const patchNodeData = useCallback(
    (id, patch) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, node: { ...n.data.node, ...patch } } }
            : n
        )
      );
    },
    [setNodes]
  );

  /** Centralized node deletion helper (interceptable later). */
  const deleteNodeById = useCallback(
    (id) => {
      if (id == "root") {return;}
      // Use functional update to avoid race conditions with other state updates
      setUserData((prev) => recursiveDelete(id, prev));
    },
    [setUserData]
  );

  /** Stable factory for per-node actions bound to a specific id. */
  const makeDataForId = useCallback(
    (id) => ({
      node: userData[id],
      updateNode: (patch) => {
        setUserData((prev) => ({
          ...prev,
          [id]: { ...prev[id], ...patch },
        }));
        patchNodeData(id, patch);
      },
      deleteNode: () => deleteNodeById(id),
      createChild: (overrides) => createChildNode(id, overrides),
    }),
    [userData, setUserData, patchNodeData, deleteNodeById]
  );

  // Initial build + layout: runs once when we first have nodes AND persistence has loaded
  useEffect(() => {
    // If persistence hasn't finished loading yet, ensure we don't lock the "did layout" flag
    if (!isLoaded) {
      didLayoutRef.current = false;
      return;
    }
    if (didLayoutRef.current) return;
    const ids = Object.keys(userData);
    if (ids.length === 0) return;

    const builtNodes = ids.map((id) => ({
      id,
      type: 'taskGraphNode',
      data: makeDataForId(id),
      position: { x: 0, y: 0 },
      hidden: userData[id]?.visible === false,
    }));
    const layoutEdges = buildEdgesForLayout(userData);

  const layouted = getLayoutedElements(builtNodes, layoutEdges, userData, 'LR');
    setNodes(layouted.nodes);
    setEdges(buildEdgesFrom(userData));
    didLayoutRef.current = true;
  }, [userData, isLoaded, makeDataForId, setNodes, setEdges]);

  // After initial layout: keep nodes/edges in sync WITHOUT re-layout
  // Option A implementation: always rebuild action closures to avoid stale state
  useEffect(() => {
    if (!didLayoutRef.current) return;
    setNodes((prevNodes) => {
      const existingById = new Map(prevNodes.map((n) => [n.id, n]));
      const nextIds = Object.keys(userData);
      let nextNodes = nextIds.map((id) => {
        const prev = existingById.get(id);
        if (prev) {
          const nextHidden = userData[id]?.visible === false;
          return { ...prev, data: makeDataForId(id), hidden: nextHidden };
        }
        const pendingPos = pendingPositionsRef.current.get(id);
        if (pendingPos) pendingPositionsRef.current.delete(id);
        return {
          id,
          type: 'taskGraphNode',
            data: makeDataForId(id),
          position: pendingPos || { x: 0, y: 0 },
          hidden: userData[id]?.visible === false,
        };
      });
      const toSelect = pendingSelectRef.current;
      if (toSelect && nextNodes.some((n) => n.id === toSelect)) {
        nextNodes = nextNodes.map((n) => ({ ...n, selected: n.id === toSelect }));
        pendingSelectRef.current = null;
      }
      return nextNodes;
    });
    setEdges(buildEdgesFrom(userData));
  }, [userData, makeDataForId, setEdges, setNodes]);

  /** Edge connect handler: adds a non-animated edge. */
  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: false }, eds)),
    [setEdges]
  );

  // Helper: generate a unique node id
  const generateId = useCallback(() => {
    try {
      return crypto.randomUUID();
    } catch {
      return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }
  }, []);

  // Helper: create a new child node under a parent id
  const createChildNode = useCallback(
    (parentId, overrides = {}) => {
      const newId = generateId();

      // Compute desired initial position: 20px to the right of parent's right edge;
      // Y: if parent has children, place below the lowest child by 20px; otherwise level with parent.
      const parentNode = nodes.find((n) => n.id === parentId);
      const parentX = parentNode?.position?.x ?? 0;
      const parentY = parentNode?.position?.y ?? 0;
  // debug removed: parentId, nodes snapshot, parentNode

      // Use explicit visual width for positioning consistency (matches .rf-node CSS width)
      const parentW = (parentNode && (parentNode.width || parentNode.measured?.width)) || nodeWidth;
      const newX = parentX + parentW + 20;
      const parentChildren = userData[parentId]?.children || [];
      let newY = parentY;
      if (parentChildren.length > 0) {
        let maxY = -Infinity;
        for (const cid of parentChildren) {
          const cn = nodes.find((n) => n.id === cid);
          if (cn?.position?.y != null && cn.height != null) {
            maxY = Math.max(maxY, cn.position.y + cn.height);
          }
        }
        if (Number.isFinite(maxY)) newY = maxY + 20; // 20px below the lowest child
      }
      pendingPositionsRef.current.set(newId, { x: newX, y: newY });

      const parentDepth = (userData[parentId]?.depth ?? 0);
      const newNode = {
        title: '',
        type: 'task',
        children: [],
        visible: true,
        completed: false,
  dueDate: null,
  repeatDays: 0,
        ...overrides,
        depth: parentDepth + 1,
      };
      setUserData((prev) => ({
        ...prev,
        [newId]: newNode,
        [parentId]: {
          ...prev[parentId],
          children: [...(prev[parentId]?.children || []), newId],
        },
      }));
      // Queue selection of the newly created node once nodes sync
      pendingSelectRef.current = newId;
      return newId;
    },
    [setUserData, generateId, nodes, userData]
  );

  // Track subtree drag state for moving entire descendant tree
  const dragStateRef = useRef({
    rootId: null,
    startPos: null,
    basePositions: new Map(), // id -> {x,y}
  });

  /** Collect descendant ids (including startId) via userData children relationships. */
  const collectDescendants = useCallback(
    (startId) => {
      const result = new Set();
      const stack = [startId];
      while (stack.length) {
        const current = stack.pop();
        if (result.has(current)) continue;
        result.add(current);
        const info = userData[current];
        if (info?.children?.length) {
          for (const c of info.children) stack.push(c);
        }
      }
      return result;
    },
    [userData]
  );

  /** Capture subtree ids and their base positions when dragging starts. */
  const onNodeDragStart = useCallback(
    (event, node) => {
      const rootId = node?.id;
      if (!rootId) return;
      const ids = collectDescendants(rootId);
      const basePositions = new Map();
      for (const n of nodes) {
        if (ids.has(n.id)) {
          basePositions.set(n.id, { x: n.position?.x ?? 0, y: n.position?.y ?? 0 });
        }
      }
      dragStateRef.current = {
        rootId,
        startPos: { x: node.position?.x ?? 0, y: node.position?.y ?? 0 },
        basePositions,
      };
    },
    [nodes, collectDescendants]
  );

  /** Apply parent movement delta to all descendants so they move as a unit. */
  const onNodeDrag = useCallback(
    (event, node) => {
      const st = dragStateRef.current;
      if (!st.rootId || st.rootId !== node.id || !st.startPos) return;
      const dx = (node.position?.x ?? 0) - st.startPos.x;
      const dy = (node.position?.y ?? 0) - st.startPos.y;
      if (dx === 0 && dy === 0) return;
      setNodes((prev) =>
        prev.map((n) => {
          const base = st.basePositions.get(n.id);
          if (!base) return n;
          return { ...n, position: { x: base.x + dx, y: base.y + dy } };
        })
      );
    },
    [setNodes]
  );

  // When a node drag ends, reorder it among its siblings based on Y position
  const onNodeDragStop = useCallback(
    (event, dragged) => {
      const draggedId = dragged?.id;
      if (!draggedId) return;

      // clear drag state
      dragStateRef.current = { rootId: null, startPos: null, basePositions: new Map() };

      // Find parent id by scanning userData
      let parentId = undefined;
      for (const [pid, info] of Object.entries(userData)) {
        if (info?.children?.includes?.(draggedId)) {
          parentId = pid;
          break;
        }
      }
      if (!parentId) return;

      const parent = userData[parentId];
      const sibs = Array.isArray(parent.children) ? [...parent.children] : [];
      if (sibs.length <= 1) return;

      // Map node id -> y position
      const posById = new Map(nodes.map((n) => [n.id, n.position?.y ?? 0]));
      // Stable sort siblings by y; tie-breaker is current order
      const orderIndex = new Map(sibs.map((id, idx) => [id, idx]));
      const sorted = [...sibs].sort((a, b) => {
        const ya = posById.get(a) ?? Number.POSITIVE_INFINITY;
        const yb = posById.get(b) ?? Number.POSITIVE_INFINITY;
        if (ya !== yb) return ya - yb;
        return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
      });

      // If nothing changed, skip
      const unchanged = sibs.length === sorted.length && sibs.every((v, i) => v === sorted[i]);
      if (unchanged) return;

      setUserData((prev) => ({
        ...prev,
        [parentId]: {
          ...prev[parentId],
          children: sorted,
        },
      }));
    },
  [nodes, userData, setUserData]
  );

  /** When a node is selected, reveal its direct children by setting visible=true. */
  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }) => {
      const selectedIds = (selectedNodes || []).map((n) => n.id);
      if (!selectedIds.length) return;

      setUserData((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const sid of selectedIds) {
          const children = prev[sid]?.children || [];
          for (const cid of children) {
            if (next[cid] && next[cid].visible === false) {
              next[cid] = { ...next[cid], visible: true };
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    },
    [setUserData]
  );

  // Keyboard: Tab focuses first child; Backspace deletes via helper (RF delete shortcut disabled)
  const onKeyDown = useCallback(
    (e) => {
      // Ignore if typing in inputs, textareas, contenteditable, or CodeMirror editor
      const target = e.target;
      const isEditable =
        target.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor') != null ||
        (target.isContentEditable ?? false);
      if (isEditable) return;

      if (e.key === 'Tab' && !e.shiftKey) {
        const selected = nodes.find((n) => n.selected);
        if (!selected) return;
        const selectedData = userData[selected.id];
        const firstChildId = selectedData?.children?.[0];
        e.preventDefault();
        e.stopPropagation();

        if (!firstChildId) {
          // No children -> create a new child and select it
          createChildNode(selected.id);
          return;
        }

        const childExists = nodes.some((n) => n.id === firstChildId);
        if (!childExists) return;

        // Update selection to the first child
        setNodes((nds) =>
          nds.map((n) => ({ ...n, selected: n.id === firstChildId }))
        );
        return;
      }

      // Arrow navigation
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const selected = nodes.find((n) => n.selected);
        if (!selected) return; // nothing selected

        // Helper to set selection
        const selectId = (targetId) => {
          if (!targetId) return;
          setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === targetId })));
          e.preventDefault();
          e.stopPropagation();
        };

        // Find parent (scan userData)
        let parentId = undefined;
        for (const [pid, info] of Object.entries(userData)) {
          if (info?.children?.includes?.(selected.id)) { parentId = pid; break; }
        }

        if (e.key === 'ArrowLeft') {
          // Go to parent if current node is not root and has a parent
            if (selected.id !== 'root' && parentId) {
              selectId(parentId);
            }
            return; // stop further processing regardless
        }

        if (e.key === 'ArrowRight') {
          // Go to first child if exists (no creation)
          const children = userData[selected.id]?.children || [];
          if (children.length > 0) {
            const firstChildId = children[0];
            selectId(firstChildId);
          }
          return;
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (!parentId) return; // root or no parent -> no sibling navigation
          const sibs = userData[parentId]?.children || [];
          const idx = sibs.indexOf(selected.id);
          if (idx === -1) return;
          if (e.key === 'ArrowUp' && idx > 0) {
            selectId(sibs[idx - 1]);
          } else if (e.key === 'ArrowDown' && idx < sibs.length - 1) {
            selectId(sibs[idx + 1]);
          }
          return;
        }
      }

      if (e.key === 'Backspace') {
        const selected = nodes.find((n) => n.selected);
        if (!selected) return;
        e.preventDefault();
        e.stopPropagation();
        // Determine next selection target: previous sibling if available; otherwise parent
        let parentId = undefined;
        for (const [pid, info] of Object.entries(userData)) {
          if (info?.children?.includes?.(selected.id)) {
            parentId = pid;
            break;
          }
        }
        if (parentId) {
          const sibs = userData[parentId]?.children || [];
          const idx = sibs.indexOf(selected.id);
          if (idx > 0) {
            pendingSelectRef.current = sibs[idx - 1];
          } else {
            // If no previous sibling, focus parent
            pendingSelectRef.current = parentId;
          }
        }
        deleteNodeById(selected.id);
      }

      if (e.key === 'Enter' && e.shiftKey) {
        const selected = nodes.find((n) => n.selected);
        if (!selected) return;
        if (selected.id === 'root') return; // don't add alongside root
        // Find parent id by scanning userData
        let parentId = undefined;
        for (const [pid, info] of Object.entries(userData)) {
          if (info?.children?.includes?.(selected.id)) {
            parentId = pid;
            break;
          }
        }
        if (!parentId) return;
        e.preventDefault();
        e.stopPropagation();
        // Create a new child under the parent (a new sibling of the selected node)
        createChildNode(parentId);
      }
    },
    [nodes, setNodes, userData, deleteNodeById, createChildNode]
  );

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        overflow: 'hidden',
        position: 'relative'
      }}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onConnect={onConnect}
          onNodeDragStop={onNodeDragStop}
          onSelectionChange={onSelectionChange}
          nodeTypes={nodeTypes}
          deleteKeyCode={null}
          fitView
          attributionPosition={null}
          nodesDraggable={true}
          nodesConnectable={false}
          nodesFocusable={true}
          elementsSelectable={true}
          disableKeyboardA11y={true}
          style={{ background: 'transparent', width: '100%', height: '100%' }}
          maxZoom={10000}
        >
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

// -----------------------------
// Utilities
// -----------------------------

function recursiveDelete(nodeId, data) {
  const newData = { ...data };

  // 1) Collect all nodes to delete (nodeId and all descendants), protect against cycles
  const stack = [nodeId];
  const toDelete = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (toDelete.has(current)) continue;
    toDelete.add(current);
    const node = newData[current];
    if (node?.children?.length) {
      for (const c of node.children) stack.push(c);
    }
  }

  // 2) Delete those nodes
  for (const id of toDelete) {
    delete newData[id];
  }

  // 3) Remove references to any deleted ids from remaining nodes' children arrays
  for (const key in newData) {
    const children = newData[key].children;
    if (Array.isArray(children) && children.length) {
      const filtered = children.filter((cid) => !toDelete.has(cid));
      if (filtered.length !== children.length) {
        newData[key] = { ...newData[key], children: filtered };
      }
    }
  }

  return newData;
}

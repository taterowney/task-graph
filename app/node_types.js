'use client';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
// Rich Markdown (Markdoc) plugin
import richMarkdown from './codemirror-rich-markdoc/index';
import markdoc from '@markdoc/markdoc';
import { Table } from '@lezer/markdown';
import { languages } from '@codemirror/language-data';
import { Handle, Position } from 'reactflow';

// -----------------------------
// Node components (per-node data)
// -----------------------------

/**
 * Render a node based on its data.type.
 * Content is wrapped in `.rf-node` to enable selection styling via CSS.
 */
export function Node({ id, data }) {
  const nodeData = data?.node;
  if (!nodeData) return null;

  // Root node remains special (no delete button)
  if (id === 'root') {
    return (
  <div className="rf-node rf-node--root">
        {/* <Handle type="target" position={Position.Left} /> */}
        <Handle type="source" position={Position.Right} />
      </div>
    );
  }

  const { updateNode, deleteNode, createChild } = data;

  // Local state to manage node type (mirrors userData) and menu visibility
  const [nodeType, setNodeType] = useState(nodeData.type);
  const [menuOpen, setMenuOpen] = useState(false);

  // Keep local state in sync if external updates occur
  useEffect(() => {
    if (nodeData.type !== nodeType) setNodeType(nodeData.type);
  }, [nodeData.type]);

  const toggleMenu = (e) => {
    e.stopPropagation();
    setMenuOpen((o) => !o);
  };

  const closeMenu = () => setMenuOpen(false);

  const convertTo = (targetType) => {
    if (targetType === nodeType) return closeMenu();
    setNodeType(targetType);
    if (targetType === 'task') {
      // Converting to task: keep title, drop content (or keep as reference if desired)
  updateNode({ type: 'task', completed: false, content: undefined, dueDate: null, repeatDays: 0 });
    } else if (targetType === 'text') {
      updateNode({ type: 'text', content: nodeData.content || '' });
    } else {
      updateNode({ type: targetType });
    }
    closeMenu();
  };

  // Close menu on outside click (pointer) or Escape key
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e) => {
      if (e.target.closest?.('[data-node-menu-root]')) return;
      closeMenu();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  let content = null;
  switch (nodeType) {
    case 'task':
      content = <TaskNode node={nodeData} updateNode={updateNode} />;
      break;
    case 'text':
      content = <TextNode node={nodeData} updateNode={updateNode} />;
      break;
    default:
      content = <p>Unknown node type: {String(nodeData.type)}</p>;
  }

  return (
    <div className="rf-node" data-node-type={nodeType}>
      <Handle type="target" position={Position.Left} />
      {/* Kebab + Delete buttons */}
      <div className="rf-node__actions" data-node-menu-root>
        <button
          onClick={toggleMenu}
          aria-label="Node menu"
          className="rf-node__btn rf-node__btn--menu"
        >
          ⋮
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); createChild && createChild(); }}
          aria-label="Add child node"
          className="rf-node__btn rf-node__btn--add"
        >
          +
        </button>
        <button
          onClick={deleteNode}
          aria-label="Delete node"
          className="rf-node__btn rf-node__btn--delete"
        >
          ✕
        </button>
        {menuOpen && (
          <div className="rf-node__menu">
            <p className="rf-node__menu-label">Type</p>
            <button
              onClick={() => convertTo('task')}
              style={menuButtonStyle(nodeType === 'task')}
            >
              Task
            </button>
            <button
              onClick={() => convertTo('text')}
              style={menuButtonStyle(nodeType === 'text')}
            >
              Text
            </button>
          </div>
        )}
      </div>
      {content}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/** Task node: title + completion toggle + delete button. */
function TaskNode({ node, updateNode }) {
  const toggleCompletion = () => updateNode({ completed: !node.completed });
  const editTitle = (newTitle) => updateNode({ title: newTitle });
  const [showScheduleEditor, setShowScheduleEditor] = React.useState(false);
  const [tempDue, setTempDue] = React.useState(node.dueDate || '');
  const [tempRepeat, setTempRepeat] = React.useState((node.repeatDays ?? 0).toString());

  // Sync local editor state if node changes externally
  React.useEffect(() => {
    if (!showScheduleEditor) {
      setTempDue(node.dueDate || '');
      setTempRepeat((node.repeatDays ?? 0).toString());
    }
  }, [node.dueDate, node.repeatDays, showScheduleEditor]);

  const saveSchedule = () => {
    const trimmedDate = tempDue.trim() || null;
    // Basic validation: allow empty or YYYY-MM-DD pattern
    const dateOk = !trimmedDate || /\d{4}-\d{2}-\d{2}/.test(trimmedDate);
    const repeatNum = parseInt(tempRepeat, 10);
    const safeRepeat = Number.isFinite(repeatNum) && repeatNum >= 0 ? repeatNum : 0;
    if (!dateOk) {
      alert('Please use YYYY-MM-DD format for due date.');
      return;
    }
    updateNode({ dueDate: trimmedDate, repeatDays: safeRepeat });
    setShowScheduleEditor(false);
  };

  // If repeating and completed, optionally compute next due (not mutating state here)
  let repeatInfo = null;
  if (node.repeatDays && node.repeatDays > 0) {
    repeatInfo = `${node.repeatDays}d repeat`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="task-node-header">
        <input type="checkbox" checked={!!node.completed} onChange={toggleCompletion} />
        <input
          type="text"
          value={node.title || ''}
          onChange={(e) => editTitle(e.target.value)}
          className="task-node-title-input"
          placeholder="Task title"
        />
        <button
          onClick={(e) => { e.stopPropagation(); setShowScheduleEditor((s) => !s); }}
          title="Edit due / repeat"
          style={{
            marginLeft: 4,
            marginTop: 20,
            border: '1px solid #ccc',
            background: '#f8f8f8',
            cursor: 'pointer',
            padding: '2px 6px',
            fontSize: 11,
            borderRadius: 4
          }}
        >⏰</button>
      </div>
      {(node.dueDate || repeatInfo) && !showScheduleEditor && (
        <div style={{ fontSize: 11, lineHeight: 1.2, color: '#444' }}>
          {node.dueDate && <span>Due: {node.dueDate}</span>}
          {node.dueDate && repeatInfo && <span style={{ margin: '0 4px' }}>•</span>}
          {repeatInfo && <span>{repeatInfo}</span>}
        </div>
      )}
      {showScheduleEditor && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 6,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 6
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11 }}>
            <span style={{ opacity: 0.7 }}>Due Date (YYYY-MM-DD)</span>
            <input
              type="date"
              value={tempDue}
              onChange={(e) => setTempDue(e.target.value)}
              style={{ fontSize: 12, padding: '2px 4px' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11 }}>
            <span style={{ opacity: 0.7 }}>Repeat (days, 0 = none)</span>
            <input
              type="number"
              min={0}
              value={tempRepeat}
              onChange={(e) => setTempRepeat(e.target.value)}
              style={{ fontSize: 12, padding: '2px 4px' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            <button
              onClick={(e) => { e.stopPropagation(); saveSchedule(); }}
              style={{
                fontSize: 11,
                padding: '2px 6px',
                cursor: 'pointer',
                background: '#e6f0ff',
                border: '1px solid #aac6ff',
                borderRadius: 4
              }}
            >Save</button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowScheduleEditor(false); }}
              style={{
                fontSize: 11,
                padding: '2px 6px',
                cursor: 'pointer',
                background: '#f5f5f5',
                border: '1px solid #ccc',
                borderRadius: 4
              }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Text node: title + CodeMirror markdown editor. */
function TextNode({ node, updateNode }) {
  const editTitle = (newTitle) => updateNode({ title: newTitle });
  const editContent = (newText) => updateNode({ content: newText });
  // Basic Markdoc config (placeholder - can be extended with custom tags)
  const markdocConfig = React.useMemo(() => ({
    tags: {
      callout: {
        render: 'div',
        attributes: { type: { type: String, default: 'info' } },
        transform(node, config) {
          const children = node.transformChildren(config);
          const kind = node.attributes.type === 'warning' ? 'warning' : 'info';
          return new markdoc.Tag('div', { class: `cm-markdoc-callout cm-markdoc-callout--${kind}` }, children);
        }
      }
    }
  }), []);

  const richExtensions = React.useMemo(() => [
    richMarkdown({
      markdoc: markdocConfig,
      lezer: {
        codeLanguages: languages,
        extensions: [Table]
      }
    })
  ], [markdocConfig]);
  return (
    <div>
      <input
        type="text"
        value={node.title || ''}
        onChange={(e) => editTitle(e.target.value)}
  className="text-node-title-input"
        placeholder="Note title"
      />
      {/* Markdown editor (CodeMirror) */}
      <div
        className="w-full rf-node__editor-wrapper nodrag"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{ cursor: 'text' }}
      >
        <CodeMirror
          value={node.content || ''}
          onChange={React.useCallback((val) => editContent(val), [])}
          extensions={richExtensions}
          basicSetup={{ lineNumbers: false }}
          className="w-full border rounded p-2 rf-node__editor"
        />
      </div>
    </div>
  );
}

// Shared style helper for menu buttons
function menuButtonStyle(active) {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: active ? '#eef4ff' : 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '6px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: active ? '600' : '400'
  };
}
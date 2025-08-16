'use client';
import { FlowChart } from "./components";
import { usePersistentUserData } from "./persistence";
import { useState, useEffect } from 'react';

// GRAPHING: ReactFlow
// https://reactflow.dev/examples

// Calendar stuff: 
// https://www.npmjs.com/package/react-google-calendar-api

// Markdown stuff: CodeMirror
// https://github.com/codemirror/lang-markdown

// TODO:
// - weird thing where sometimes keybinds don't work on a selected node after you've just deleted some other nodes
// - Autofocus new nodes' titles when created
// - Add confirmation modal on deletion
// - (the above 2 features introduce the same bugs when trying to implement them, and break a lot of old features)
// - deployment
// - Fix sidebar on mobile
// - cloud storage
// - (later) GCal integration


export default function Home() {
  const [showCredits, setShowCredits] = useState(false);
  const initial = {
      "root": {
        "title": "Root Node",
        "children": ["12345", "67890"],
        "type": "task",
        "visible": true,
        "dueDate": null,
        "repeatDays": 0,
      },
      "12345": {
          "title": "Task Node", 
          "children": ["abcde"],
          "type": "task",
          "completed": false,
          "visible": true,
          "dueDate": null,
          "repeatDays": 0,
      },
      "67890": {
        "title": "Task Node 2", 
        "children": [],
        "type": "task",
        "completed": true,
        "visible": true,
        "dueDate": null,
        "repeatDays": 0,
    },
      "abcde": {
          "title": "Text Node", 
          "children": [],
          "type": "text",
          "content": "This is a text node.",
          "visible": false,
      }
  };
  const [ userData, setUserData, isLoaded ] = usePersistentUserData(initial);

  // On load: advance any repeating task's dueDate ONLY if it is completed and overdue (past today);
  // after advancing, mark it incomplete (completed:false) so it reappears as an active task.
  useEffect(() => {
    if (!isLoaded) return; // wait for persistence
    setUserData((prev) => {
      let changed = false;
      const next = { ...prev };
      const today = new Date();
      today.setHours(0,0,0,0);
      for (const [id, node] of Object.entries(prev)) {
        if (!node || !node.dueDate || !(node.repeatDays > 0) || node.completed !== true) continue;
        // Parse date (YYYY-MM-DD)
        const parts = node.dueDate.split('-');
        if (parts.length !== 3) continue;
        const year = Number(parts[0]);
        const month = Number(parts[1]) - 1;
        const day = Number(parts[2]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) continue;
        let due = new Date(year, month, day);
        if (isNaN(due.getTime())) continue;
        due.setHours(0,0,0,0);
        if (due >= today) continue; // only adjust past-due tasks
        const step = node.repeatDays;
        if (step <= 0) continue;
        let guard = 0;
        const originalTime = due.getTime();
        while (due < today && guard < 1000) {
          due.setDate(due.getDate() + step);
          guard++;
        }
        if (due.getTime() !== originalTime) {
          const newDueStr = due.toISOString().slice(0,10);
          next[id] = { ...node, dueDate: newDueStr, completed: false };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [isLoaded, setUserData]);

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 140,
          minHeight: 40,
          background: '#ffffff',
          zIndex: 1000,
          padding: '6px 8px',
          fontSize: 12,
          boxSizing: 'border-box'
        }}
      >
      </div>

  {/* Left Sidebar: Due & Overdue Tasks */}
  <SidebarTasks userData={userData} />

      <FlowChart data={userData} setData={setUserData} isLoaded={isLoaded} />

      {/* Credits trigger */}
      <span
        onClick={() => setShowCredits(true)}
        style={{
          position: 'fixed',
          bottom: 10,
          right: 14,
          fontSize: 16,
          cursor: 'pointer',
          color: '#555',
          userSelect: 'none',
          zIndex: 1000
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowCredits(true); } }}
      >
        Credits
      </span>

      {showCredits && (
        <div
          style={{
            position: 'fixed',
            bottom: 50,
            right: 14,
            width: 260,
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: '12px 14px 14px',
            fontSize: 12,
            lineHeight: 1.4,
            zIndex: 1100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Credits"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <strong style={{ fontSize: 12 }}>Credits</strong>
            <button
              onClick={() => setShowCredits(false)}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                padding: 2
              }}
              aria-label="Close credits"
            >
              ✕
            </button>
          </div>
          <p style={{ margin: 0 }}>
            This app uses <a href="https://reactflow.dev" target="_blank" rel="noreferrer">React Flow</a> for graph visualization
            and <a href="https://codemirror.net/" target="_blank" rel="noreferrer">CodeMirror</a> for the markdown editor. Developed by <a href="https://taterowney.com" target="_blank" rel="noreferrer">Tate Rowney</a>.
          </p>
        </div>
      )}
    </>
  )
};

// Sidebar component listing tasks due today or in the past.
function SidebarTasks({ userData }) {
  // Derive list
  const items = Object.entries(userData || [])
  .filter(([_, n]) => n && n.type === 'task' && n.dueDate && n.completed !== true)
    .map(([id, n]) => ({ id, ...n }));
  if (!items.length) {
    return (
      <div style={sidebarStyle}><strong style={{fontSize:30}}>Today</strong><div style={{fontSize:18,opacity:0.6,marginTop:6}}>Nothing to do today!</div></div>
    );
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const parsed = items.map((t) => {
    let d = null;
    if (/\d{4}-\d{2}-\d{2}/.test(t.dueDate)) {
      const [y,m,day] = t.dueDate.split('-').map(Number);
      d = new Date(y, m-1, day); d.setHours(0,0,0,0);
    }
    return { ...t, _due: d };
  }).filter(t => t._due && t._due <= today);
  if (!parsed.length) {
    return (
      <div style={sidebarStyle}><strong style={{fontSize:30}}>Today</strong><div style={{fontSize:18,opacity:0.6,marginTop:6}}>Nothing to do today!</div></div>
    );
  }
  // Sort: overdue (past) first by date asc, then today tasks by title
  parsed.sort((a,b)=>{
    const aPast = a._due < today; const bPast = b._due < today;
    if (aPast !== bPast) return aPast ? -1 : 1;
    if (aPast) { // both past
      return a._due - b._due || (a.title||'').localeCompare(b.title||'');
    }
    // both today
    return (a.title||'').localeCompare(b.title||'');
  });
  return (
    <div style={sidebarStyle}>
      <strong style={{fontSize:30}}>Today</strong>
      <ul style={{listStyle:'none', padding:0, margin:'6px 0 0', maxHeight:'calc(100vh - 60px)', overflowY:'auto'}}>
        {parsed.map(task => {
          const overdue = task._due < today;
          return (
            <li key={task.id} style={{fontSize:18, marginBottom:6, display:'flex', flexDirection:'column'}}>
              <span style={{display:'flex', alignItems:'center', gap:4}}>
                {overdue ? <span style={overdueDotStyle} title="Overdue" /> : <span style={todayDotStyle} title="Due Today" />}
                <span style={{fontWeight:500}}>{task.title || '(untitled task)'}</span>
              </span>
              <span style={{marginLeft:14, color: overdue ? '#c62828' : '#333'}}>
                {task.dueDate}{task.repeatDays>0 && <span style={{marginLeft:4, opacity:0.7}}>↻ {task.repeatDays}d</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const sidebarStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '225px',
  height: '100%',
  background: '#ffffff',
  zIndex: 1000,
  padding: '20px 20px 12px',
  fontSize: 20,
  boxSizing: 'border-box',
  border: '1px solid #e2e2e2',
  borderRadius: 10,
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  display: 'flex',
  flexDirection: 'column',
  marginLeft: '1vw',
  marginTop: '1vw',
  marginBottom: '1vw'
};

const overdueDotStyle = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#e53935',
  boxShadow: '0 0 0 2px #ffebee'
};

const todayDotStyle = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: '#159d09ff',
  boxShadow: '0 0 0 2px #fff8e1'
};
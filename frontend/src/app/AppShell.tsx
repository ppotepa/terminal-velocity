import { useState } from 'react';
import { Activity, Bell, ChevronDown, Compass, History, MessageSquareText, Radio, Settings2, ShieldCheck } from 'lucide-react';

type Section = 'Map' | 'Watch Rules' | 'History' | 'Messages' | 'Alerts' | 'Source Settings';
const sections: { label: Section; icon: typeof Compass; description: string }[] = [
  { label: 'Map', icon: Compass, description: 'Observed aircraft will appear here when a Watch Rule is active.' },
  { label: 'Watch Rules', icon: ShieldCheck, description: 'Select the aircraft and flights you want to observe.' },
  { label: 'History', icon: History, description: 'Observed tracks and known country crossings.' },
  { label: 'Messages', icon: MessageSquareText, description: 'Messages collected for selected aircraft.' },
  { label: 'Alerts', icon: Bell, description: 'Conditions and notifications for your watched aircraft.' },
  { label: 'Source Settings', icon: Settings2, description: 'Provider status and collection limits.' },
];

export default function AppShell() {
  const [active, setActive] = useState<Section>('Map');
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = sections.find((section) => section.label === active)!;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label="Workspace navigation">
        <a className="brand" href="#map" onClick={() => setActive('Map')}>
          <span className="brand-mark"><Activity size={18} strokeWidth={2.2} /></span>
          <span><strong>Terminal Velocity</strong><small>FLIGHT INTELLIGENCE</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Primary">
          {sections.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${active === label ? 'active' : ''}`} aria-current={active === label ? 'page' : undefined} onClick={() => { setActive(label); setMobileOpen(false); }}>
              <Icon size={17} aria-hidden="true" /><span>{label}</span>
              {label === 'Alerts' && <span className="nav-dot" aria-label="No unread alerts" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="connection-dot" /><span>Local workspace</span><span className="synthetic-chip">SYNTHETIC</span></div>
      </aside>
      {mobileOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen((open) => !open)} aria-expanded={mobileOpen} aria-label="Toggle navigation">☰</button>
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-sep">/</span><strong>{active}</strong></div>
          <button className="workspace-button"><span className="avatar">TV</span><span>Local workspace</span><ChevronDown size={14} /></button>
        </header>
        <section className="page-content" aria-labelledby="page-title">
          <div className="page-heading"><div><div className="eyebrow">TERMINAL VELOCITY 1.0</div><h1 id="page-title">{active}</h1><p>{current.description}</p></div><div className="mode-badge"><Radio size={14} /> Local demo</div></div>
          <div className="placeholder-panel"><div className="empty-icon"><current.icon size={23} /></div><h2>{active === 'Map' ? 'No aircraft selected yet' : `${active} is ready for setup`}</h2><p>{active === 'Map' ? 'Create an active Watch Rule to see observed positions here. No aircraft are shown until a rule selects them.' : current.description}</p>{active === 'Map' && <button className="primary-button" onClick={() => setActive('Watch Rules')}>Configure a Watch Rule</button>}</div>
        </section>
      </main>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Activity, AlertCircle, ArrowRight, BadgeCheck, Check, ChevronDown,
  Clock3, Eye, LayoutDashboard, LogOut, Monitor, Phone, Plus, Search,
  ShieldCheck, SkipForward, Ticket, Users, X,
} from 'lucide-react';

const emptyQueue = { current: null, upcoming: [], stats: {}, bookings: [] };
const services = ['Aadhaar Services', 'Passport Services', 'Healthcare', 'Banking', 'Other'];
const readStoredAdmin = () => {
  try { return JSON.parse(localStorage.getItem('queuechain_admin') || 'null'); }
  catch { return null; }
};

async function request(path, { token, ...options } = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
  return body;
}

function formatToken(value) {
  return value == null ? '---' : String(value).padStart(3, '0');
}

function App() {
  const [page, setPage] = useState('booking');
  const [queue, setQueue] = useState(emptyQueue);
  const [connected, setConnected] = useState(false);
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('queuechain_admin_token') || '');
  const [admin, setAdmin] = useState(readStoredAdmin);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const state = await request(adminToken ? '/api/admin/dashboard' : '/api/queue/current', { token: adminToken });
      setQueue({
        current: state.current || null,
        upcoming: state.upcoming || [],
        stats: state.stats || {},
        bookings: state.bookings || [],
      });
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
    }
  }, [adminToken]);

  useEffect(() => {
    refresh();
    const socket = io({ path: '/socket.io', reconnection: true });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('queue:update', refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      window.clearInterval(timer);
      socket.disconnect();
    };
  }, [refresh]);

  useEffect(() => {
    if (notice) {
      const timer = window.setTimeout(() => setNotice(null), 6000);
      return () => window.clearTimeout(timer);
    }
  }, [notice]);

  const execute = async (fn, successText) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await fn();
      setNotice({ type: 'success', text: successText(result) });
      await refresh();
      return result;
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const changeAdmin = (token, user) => {
    setAdminToken(token);
    setAdmin(user);
    localStorage.setItem('queuechain_admin_token', token);
    localStorage.setItem('queuechain_admin', JSON.stringify(user));
  };

  const logout = () => {
    localStorage.removeItem('queuechain_admin_token');
    localStorage.removeItem('queuechain_admin');
    setAdminToken('');
    setAdmin(null);
    setOfflineMode(false);
    setPage('booking');
  };

  const openHistory = async () => {
    setHistoryOpen((open) => !open);
    if (!historyOpen) {
      await execute(async () => {
        const result = await request('/api/admin/blockchain/history', { token: adminToken });
        setHistory(result.events || []);
        return result;
      }, () => 'Blockchain history loaded.');
    }
  };

  const filteredBookings = useMemo(() => queue.bookings.filter((booking) => {
    const matchesText = `${booking.dailyTokenNumber} ${booking.fullName} ${booking.serviceRequired} ${booking.bookingSource}`
      .toLowerCase().includes(filter.toLowerCase());
    return matchesText && (statusFilter === 'ALL' || booking.status === statusFilter);
  }), [queue.bookings, filter, statusFilter]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage('booking')} aria-label="QueueChain home">
          <span className="brand-mark"><Ticket size={20} /></span>
          <span><strong>QueueChain</strong><small>One Queue. One Sequence.</small></span>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={page === 'booking' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('booking')}>
            <Plus size={16} /> Booking portal
          </button>
          <button className={page === 'display' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('display')}>
            <Monitor size={16} /> Public display
          </button>
          <button className={page === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('admin')}>
            <LayoutDashboard size={16} /> Admin
          </button>
        </nav>
        <div className="connection"><i className={connected ? 'online' : ''} />{connected ? 'Live updates on' : 'Connecting'}</div>
      </header>

      <main>
        {notice && <div className={`notice ${notice.type}`} role="status">
          {notice.type === 'success' ? <Check size={18} /> : <AlertCircle size={18} />}{notice.text}
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button>
        </div>}
        {page === 'booking' && <BookingPortal
          admin={admin} adminToken={adminToken} busy={busy} execute={execute} queue={queue}
          offline={offlineMode} setOffline={setOfflineMode}
        />}
        {page === 'display' && <PublicDisplay queue={queue} busy={busy} execute={execute} />}
        {page === 'admin' && <AdminPage
          admin={admin} adminToken={adminToken} setAdmin={changeAdmin} logout={logout}
          queue={queue} busy={busy} execute={execute} filteredBookings={filteredBookings}
          filter={filter} setFilter={setFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          openHistory={openHistory} historyOpen={historyOpen} history={history}
          onOfflineBooking={() => { setOfflineMode(true); setPage('booking'); }}
        />}
      </main>
      <footer><span><ShieldCheck size={15} /> Personal details stay private. Queue actions are recorded on-chain.</span><span>QueueChain prototype · Single service centre</span></footer>
    </div>
  );
}

function BookingPortal({ admin, adminToken, busy, execute, queue, offline, setOffline }) {
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', serviceRequired: '' });
  const activeOffline = offline && admin && adminToken;
  const change = (event) => setForm((value) => ({ ...value, [event.target.name]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setResult(null);
    const created = await execute(() => request(activeOffline ? '/api/admin/bookings' : '/api/bookings', {
      method: 'POST',
      token: activeOffline ? adminToken : undefined,
      body: JSON.stringify({ ...form, bookingSource: activeOffline ? 'OFFLINE' : 'ONLINE', requestId: crypto.randomUUID() }),
    }), (booking) => `Booking confirmed. Token ${formatToken(booking.dailyTokenNumber)}.`);
    if (created) {
      setResult(created);
      setForm({ fullName: '', phone: '', email: '', serviceRequired: '' });
    }
  };

  return <section className="booking-layout">
    <div className="booking-copy">
      <div className="eyebrow"><span className="eyebrow-dot" /> FAIR · ORDERLY · TRANSPARENT</div>
      <h1>Your turn,<br /><em>without the wait.</em></h1>
      <p className="lead">Join the same trusted queue whether you book online or at the service centre. Your token is assigned in order — never manually.</p>
      <div className="promise-row">
        <div><span className="promise-icon"><Clock3 size={18} /></span><span><b>One shared queue</b><small>Online + walk-in, in order</small></span></div>
        <div><span className="promise-icon"><ShieldCheck size={18} /></span><span><b>Recorded on blockchain</b><small>Private details stay off-chain</small></span></div>
      </div>
      <div className="queue-summary"><div className="summary-icon"><Users size={20} /></div><div><b>{queue.stats.waiting ?? queue.upcoming.length} people</b><span>currently waiting</span></div><div className="summary-divider" /><div><b>{queue.current ? formatToken(queue.current.dailyTokenNumber) : '—'}</b><span>now serving</span></div></div>
    </div>
    <div className="form-card">
      <div className="card-title-row">
        <div><span className="eyebrow">BOOK YOUR VISIT</span><h2>Get your queue token</h2></div>
        <span className="step-badge">01 <span>/ 01</span></span>
      </div>
      {admin && <button className={`mode-toggle ${offline ? 'selected' : ''}`} onClick={() => { setOffline((value) => !value); setResult(null); }}>
        <span className="toggle-switch" /> Register a walk-in visitor <span className="admin-chip">{admin.name}</span>
      </button>}
      <form className="booking-form" onSubmit={submit}>
        <label>Full name<input name="fullName" autoComplete="name" placeholder="e.g. Aanya Sharma" value={form.fullName} onChange={change} maxLength="120" required /></label>
        <label>Phone number<input name="phone" type="tel" autoComplete="tel" placeholder="10-digit mobile number" value={form.phone} onChange={change} pattern="[+0-9 ()-]{7,20}" required /></label>
        <label>Email address <span className="optional">Optional</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={change} maxLength="254" /></label>
        <label>Service required<select name="serviceRequired" value={form.serviceRequired} onChange={change} required>
          <option value="" disabled>Select a service</option>{services.map((service) => <option key={service}>{service}</option>)}
        </select></label>
        <div className="form-note"><ShieldCheck size={16} /> Your contact details are securely stored and never published.</div>
        <button className="primary-button full" disabled={busy || (offline && !activeOffline)}>{busy ? 'Confirming booking…' : <>{activeOffline ? 'Register walk-in' : 'Join the queue'} <ArrowRight size={17} /></>}</button>
      </form>
      {result && <div className="booking-success"><span><Check size={20} /></span><div><b>Booking confirmed — token {formatToken(result.dailyTokenNumber)}</b><small>Please keep this number and wait for your token to be called.</small></div></div>}
      {!admin && <p className="below-form">Visiting in person? An administrator can register your walk-in using this same form.</p>}
    </div>
  </section>;
}

function PublicDisplay({ queue, busy, execute }) {
  const [phone, setPhone] = useState('');
  const current = queue.current;
  const isVerified = current?.status === 'VERIFIED';
  const verify = async (event) => {
    event.preventDefault();
    const response = await execute(() => request('/api/queue/verify', {
      method: 'POST', body: JSON.stringify({ phone }),
    }), () => 'Your booking has been verified.');
    if (response) setPhone('');
  };
  return <section className="display-page">
    <div className="display-heading"><div><span className="eyebrow">SERVICE CENTRE · LIVE QUEUE</span><h1>Queue display</h1></div><div className="display-meta"><span className="display-date">{queue.date ? new Date(`${queue.date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ''}</span><span className="live-pill"><i /> LIVE</span></div></div>
    <div className="display-main">
      <div className="now-card">
        <div className="now-label"><span className="pulse" /> NOW SERVING</div>
        <div className="huge-token">{formatToken(current?.dailyTokenNumber)}</div>
        <div className="counter-call">{current ? 'PLEASE PROCEED TO COUNTER 01' : 'WAITING FOR THE NEXT VISITOR'}</div>
        {current && <div className="serving-detail">Now serving · {current.serviceRequired}</div>}
      </div>
      <aside className="upcoming-card">
        <span className="eyebrow">UP NEXT</span><h2>Upcoming tokens</h2>
        {queue.upcoming.length ? <div className="upcoming-list">{queue.upcoming.slice(0, 5).map((token, index) =>
          <div className="upcoming-item" key={token.bookingUuid || token.dailyTokenNumber}><span>{formatToken(token.dailyTokenNumber)}</span><b>{token.serviceRequired}</b><small>{index === 0 ? 'NEXT' : 'WAITING'}</small></div>)}</div> :
          <div className="empty-upcoming"><Ticket size={22} /> No visitors waiting</div>}
      </aside>
    </div>
    <div className="verify-card">
      <div className="verify-intro"><span className="verify-icon"><Phone size={19} /></span><div><h2>Visitor verification</h2><p>Enter the phone number registered for the token currently being called.</p></div></div>
      {isVerified ? <div className="verified-state"><BadgeCheck size={21} /> Verified for the current call</div> :
        <form className="verify-form" onSubmit={verify}><label className="sr-only" htmlFor="verify-phone">Registered phone number</label><input id="verify-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Registered phone number" required /><button className="primary-button" disabled={busy || current?.status !== 'CALLED'}>Verify booking <ArrowRight size={16} /></button></form>}
      <small className="prototype-note">Phone matching is a prototype check, not secure identity verification.</small>
    </div>
  </section>;
}

function AdminPage(props) {
  const { admin, adminToken, setAdmin, logout, queue, busy, execute, filteredBookings, filter, setFilter, statusFilter, setStatusFilter, openHistory, historyOpen, history, onOfflineBooking } = props;
  const [login, setLogin] = useState({ email: '', password: '' });
  const [setupMode, setSetupMode] = useState(false);
  const [setup, setSetup] = useState({ setupKey: '', name: '', email: '', password: '' });
  const [setupAvailable, setSetupAvailable] = useState(false);

  useEffect(() => {
    request('/api/admin/setup-status').then((state) => setSetupAvailable(state.setupRequired)).catch(() => {});
  }, []);

  const signIn = async (event) => {
    event.preventDefault();
    const result = await execute(() => request('/api/admin/login', { method: 'POST', body: JSON.stringify(login) }), () => 'Signed in successfully.');
    if (result) setAdmin(result.token, result.admin);
  };
  const createAdmin = async (event) => {
    event.preventDefault();
    const result = await execute(() => request('/api/admin/setup', { method: 'POST', body: JSON.stringify(setup) }), () => 'Administrator account created.');
    if (result) { setAdmin(result.token, result.admin); setSetupAvailable(false); }
  };

  if (!admin || !adminToken) return <section className="auth-page">
    <div className="auth-card"><span className="auth-icon"><ShieldCheck size={23} /></span>
      <span className="eyebrow">{setupMode ? 'INITIAL SETUP' : 'ADMINISTRATOR ACCESS'}</span>
      <h1>{setupMode ? 'Create your admin account' : 'Welcome back'}</h1>
      <p>{setupMode ? 'The first administrator is created securely using the setup key configured on the backend.' : 'Sign in to manage today’s service-centre queue.'}</p>
      <form className="booking-form" onSubmit={setupMode ? createAdmin : signIn}>
        {setupMode && <><label>Setup key<input type="password" value={setup.setupKey} onChange={(e) => setSetup({ ...setup, setupKey: e.target.value })} required /></label><label>Your name<input value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} required /></label></>}
        {setupMode && <label>Email address<input type="email" value={setup.email} onChange={(e) => setSetup({ ...setup, email: e.target.value })} required /></label>}
        {!setupMode && <label>Email address<input type="email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} required /></label>}
        <label>Password<input type="password" minLength="12" value={setupMode ? setup.password : login.password} onChange={(e) => setupMode ? setSetup({ ...setup, password: e.target.value }) : setLogin({ ...login, password: e.target.value })} required /></label>
        <button className="primary-button full" disabled={busy}>{busy ? 'Please wait…' : setupMode ? 'Create administrator' : 'Sign in'} <ArrowRight size={17} /></button>
      </form>
      {setupAvailable && <button className="text-button" onClick={() => setSetupMode(!setupMode)}>{setupMode ? 'Back to sign in' : 'First time? Set up administrator'}</button>}
    </div>
  </section>;

  const current = queue.current;
  const action = (path, body = {}) => execute(() => request(path, {
    method: 'POST', token: adminToken, body: JSON.stringify(body),
  }), (result) => result.message || 'Queue updated successfully.');

  return <section className="admin-page">
    <div className="admin-heading"><div><span className="eyebrow">SERVICE CENTRE CONTROL</span><h1>Dashboard</h1><p>Manage the unified queue and monitor today’s activity.</p></div>
      <div className="admin-user"><span className="avatar">{(admin.name || 'A').slice(0, 1).toUpperCase()}</span><div><b>{admin.name}</b><small>Administrator</small></div><button className="icon-button" onClick={logout} title="Sign out"><LogOut size={18} /></button></div>
    </div>
    <div className="stats-grid">
      <Stat icon={<Ticket />} label="Bookings today" value={queue.stats.total ?? 0} tone="blue" />
      <Stat icon={<Clock3 />} label="Waiting visitors" value={queue.stats.waiting ?? 0} tone="amber" />
      <Stat icon={<Activity />} label="Now serving" value={current ? formatToken(current.dailyTokenNumber) : '—'} tone="purple" />
      <Stat icon={<BadgeCheck />} label="Verified" value={queue.stats.verified ?? 0} tone="green" />
      <Stat icon={<Check />} label="Completed" value={queue.stats.completed ?? 0} tone="teal" />
      <Stat icon={<SkipForward />} label="Skipped" value={queue.stats.skipped ?? 0} tone="red" />
    </div>
    <div className="admin-grid">
      <div className="queue-control card">
        <div className="section-title"><div><span className="eyebrow">QUEUE CONTROL</span><h2>Current service</h2></div><span className={`status-tag ${current ? current.status.toLowerCase() : 'idle'}`}>{current?.status || 'IDLE'}</span></div>
        <div className="current-ticket"><small>CURRENT TOKEN</small><strong>{formatToken(current?.dailyTokenNumber)}</strong><span>{current ? `${current.fullName} · ${current.serviceRequired}` : 'No visitor is currently being called'}</span></div>
        <div className="control-actions">
          <button className="primary-button full" disabled={busy || Boolean(current)} onClick={() => action('/api/admin/queue/call-next')}><ArrowRight size={17} /> Call next visitor</button>
          <div className="split-actions">
            <button className="secondary-button" disabled={busy || !current} onClick={() => {
              const reason = window.prompt('Reason for skipping this token (required):');
              if (reason?.trim()) action('/api/admin/queue/skip', { reason: reason.trim() });
            }}><SkipForward size={16} /> Skip current</button>
            <button className="secondary-button" disabled={busy || current?.status !== 'VERIFIED'} onClick={() => action('/api/admin/queue/complete')}><Check size={16} /> Complete</button>
          </div>
          <button className="outline-button full" disabled={busy} onClick={onOfflineBooking}><Plus size={16} /> Create offline booking</button>
        </div>
        <button className="history-toggle" onClick={openHistory}><Activity size={16} /> {historyOpen ? 'Hide' : 'View'} blockchain transaction history <ChevronDown size={16} className={historyOpen ? 'rotate' : ''} /></button>
        {historyOpen && <div className="history-list">{history.length ? history.map((event, index) => <div className="history-item" key={`${event.transactionHash}-${index}`}><b>{event.eventType}</b><span>Token {formatToken(event.dailyTokenNumber)}</span><code>{event.transactionHash}</code></div>) : <p>No recorded transactions yet.</p>}</div>}
      </div>
      <div className="bookings-card card">
        <div className="section-title"><div><span className="eyebrow">LIVE QUEUE</span><h2>Bookings <span className="count-badge">{queue.bookings.length}</span></h2></div><button className="icon-button" onClick={() => window.open('/api/queue/current', '_blank')} title="Open public queue data"><Eye size={18} /></button></div>
        <div className="table-tools"><label className="search-field"><Search size={16} /><input placeholder="Search name, token, service…" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status"><option value="ALL">All statuses</option>{['WAITING', 'CALLED', 'VERIFIED', 'COMPLETED', 'SKIPPED'].map((status) => <option key={status}>{status}</option>)}</select></div>
        <div className="table-wrap"><table><thead><tr><th>TOKEN</th><th>VISITOR</th><th>SOURCE</th><th>SERVICE</th><th>TIME</th><th>STATUS</th></tr></thead>
          <tbody>{filteredBookings.map((booking) => <tr key={booking.bookingUuid}><td className="token-cell">{formatToken(booking.dailyTokenNumber)}</td><td><b>{booking.fullName}</b><small className="phone-mask">•••• {booking.phoneLastFour || '••••'}</small></td><td><span className={`source-tag ${booking.bookingSource.toLowerCase()}`}>{booking.bookingSource}</span></td><td>{booking.serviceRequired}</td><td>{new Date(booking.bookingTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td><span className={`status-tag ${booking.status.toLowerCase()}`}>{booking.status}</span></td></tr>)}
            {!filteredBookings.length && <tr><td className="empty-table" colSpan="6">No bookings match this search.</td></tr>}</tbody>
        </table></div>
      </div>
    </div>
  </section>;

}

function Stat({ icon, label, value, tone }) {
  return <div className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

export default App;

'use client';
import { useEffect, useRef, useState } from 'react';
import { sb } from '../lib/supabase';

const CORE = [['wore','What I wore today'],['ate','What I ate today'],['did','What I got done today'],['learned','What I learned today']];
const OPT = [['went','Where I went today'],['slept','How I slept'],['media','What I listened to / watched / read'],['top3','Tomorrow’s top 3']];
const TAGS = ['work','lecture','event','gym','study','errand'];
const ymd = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');

export default function Page() {
  const [ses, setSes] = useState(undefined);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSes(data.session));
    const { data: l } = sb.auth.onAuthStateChange((_e, s) => setSes(s));
    return () => l.subscription.unsubscribe();
  }, []);
  if (ses === undefined) return null;
  return ses ? <App uid={ses.user.id} /> : <Auth />;
}

function Auth() {
  const [up, setUp] = useState(false), [f, setF] = useState({ email:'', username:'', password:'' }), [msg, setMsg] = useState('');
  const set = k => e => setF({ ...f, [k]: e.target.value });
  async function go() {
    setMsg('');
    const r = up
      ? await sb.auth.signUp({ email: f.email, password: f.password, options: { data: { username: f.username.trim() } } })
      : await sb.auth.signInWithPassword({ email: f.email, password: f.password });
    if (r.error) setMsg(r.error.message);
    else if (up && !r.data.session) setMsg('Check your email to confirm, then sign in.');
  }
  return (<main><h1>whatdidyougetdone</h1><p className="mu">Log what you wore, ate, did and learned.</p>
    <div className="card">
      <input type="email" placeholder="email" value={f.email} onChange={set('email')} />
      {up && <input type="text" placeholder="username (3-24 characters)" value={f.username} onChange={set('username')} />}
      <input type="password" placeholder="password" value={f.password} onChange={set('password')} />
      {msg && <p className="mu">{msg}</p>}
      <button className="p" onClick={go}>{up ? 'Create account' : 'Sign in'}</button>{' '}
      <button onClick={() => setUp(!up)}>{up ? 'I have an account' : 'New here?'}</button>
    </div></main>);
}

function App({ uid }) {
  const TODAY = ymd(new Date());
  const [view, setView] = useState('today'), [sel, setSel] = useState(TODAY), [cm, setCm] = useState(new Date());
  const [ent, setEnt] = useState({}), [prof, setProf] = useState({ username:'', theme:'auto', extras:{} });
  const timers = useRef({});

  useEffect(() => {
    (async () => {
      const { data: p } = await sb.from('profiles').select('username,theme,extras').eq('id', uid).single();
      if (p) setProf({ ...p, extras: p.extras || {} });
      const { data: rows } = await sb.from('entries').select('*').eq('user_id', uid);
      const m = {};
      (rows || []).forEach(r => { (m[r.entry_date] ||= {})[r.type] = { body: r.body, tags: r.tags || [], media_path: r.media_path }; });
      const paths = (rows || []).filter(r => r.media_path).map(r => r.media_path);
      if (paths.length) {
        const { data: urls } = await sb.storage.from('media').createSignedUrls(paths, 3600);
        (urls || []).forEach(u => { Object.values(m).forEach(d => Object.values(d).forEach(e => { if (e.media_path === u.path) e.url = u.signedUrl; })); });
      }
      setEnt(m);
    })();
  }, [uid]);

  useEffect(() => {
    const r = document.documentElement;
    prof.theme === 'auto' ? r.removeAttribute('data-theme') : r.setAttribute('data-theme', prof.theme);
  }, [prof.theme]);

  const get = (d, t) => ent[d]?.[t] || { body: '', tags: [] };
  const has = d => Object.values(ent[d] || {}).some(e => e.body || e.media_path || (e.tags && e.tags.length));
  const streak = () => { const d = new Date(); let n = 0; if (!has(ymd(d))) d.setDate(d.getDate() - 1); while (has(ymd(d))) { n++; d.setDate(d.getDate() - 1); } return n; };
  const week = () => { const d = new Date(); let n = 0; for (let i = 0; i < 7; i++) { if (has(ymd(d))) n++; d.setDate(d.getDate() - 1); } return n; };

  function save(type, patch, now) {
    const date = sel, cur = { ...get(date, type), ...patch };
    setEnt(e => ({ ...e, [date]: { ...(e[date] || {}), [type]: cur } }));
    clearTimeout(timers.current[date + type]);
    const run = () => sb.from('entries').upsert({ user_id: uid, entry_date: date, type, body: cur.body || '', tags: cur.tags || [], media_path: cur.media_path || null }, { onConflict: 'user_id,entry_date,type' });
    now ? run() : (timers.current[date + type] = setTimeout(run, 600));
  }
  async function photo(type, file) {
    if (!file) return;
    const bmp = await createImageBitmap(file), s = Math.min(1, 900 / bmp.width), c = document.createElement('canvas');
    c.width = bmp.width * s; c.height = bmp.height * s; c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.75)), path = `${uid}/${sel}-${type}.jpg`;
    const up = await sb.storage.from('media').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (up.error) return alert(up.error.message);
    const { data } = await sb.storage.from('media').createSignedUrl(path, 3600);
    save(type, { media_path: path, url: data?.signedUrl }, true);
  }
  function setProfile(p) { setProf(x => ({ ...x, ...p })); sb.from('profiles').update(p).eq('id', uid); }
  const toggleTag = t => { const cur = get(sel, 'did').tags || []; save('did', { tags: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] }, true); };

  const cards = CORE.concat(OPT.filter(o => prof.extras[o[0]]));
  const Today = () => (<>
    <div className="top"><div><h1>Hi, {prof.username}</h1><div className="mu">{sel === TODAY ? 'Today' : sel}</div></div><div className="streak">🔥 {streak()}</div></div>
    {cards.map(([k, label]) => { const v = get(sel, k); return (<div className="card" key={k + sel}><h3>{label}</h3>
      {k === 'top3'
        ? [0, 1, 2].map(i => <input key={i} type="text" placeholder={`${i + 1}.`} defaultValue={(v.body || '').split('\n')[i] || ''}
            onChange={e => { const a = (v.body || '').split('\n'); a[i] = e.target.value; v.body = a.slice(0, 3).join('\n'); save(k, { body: v.body }); }} />)
        : <textarea placeholder="Write here..." defaultValue={v.body} onChange={e => save(k, { body: e.target.value })} />}
      {(k === 'wore' || k === 'ate') && (<>{v.url && <img className="ph" src={v.url} alt="" />}
        <div className="chips"><label><input type="file" accept="image/*" hidden onChange={e => photo(k, e.target.files[0])} /><span className="chip" style={{ padding: '8px 12px', border: '1px solid var(--bd)', borderRadius: 10, cursor: 'pointer', display: 'inline-block', background: 'var(--chip)' }}>{v.url ? 'Change photo' : 'Add photo'}</span></label></div></>)}
      {k === 'did' && <div className="chips">{TAGS.map(t => <button key={t} className={'chip ' + ((v.tags || []).includes(t) ? 'on' : '')} onClick={() => toggleTag(t)}>{t}</button>)}</div>}
    </div>); })}</>);

  const Cal = () => {
    const y = cm.getFullYear(), m = cm.getMonth(), f = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate(), d = ent[sel] || {};
    return (<>
      <div className="top"><button onClick={() => setCm(new Date(y, m - 1, 1))}>‹</button><h1>{cm.toLocaleString('en', { month: 'long', year: 'numeric' })}</h1><button onClick={() => setCm(new Date(y, m + 1, 1))}>›</button></div>
      <p className="mu">This week: {week()} of 7 days logged · Streak: {streak()}</p>
      <div className="grid">{['S','M','T','W','T','F','S'].map((x, i) => <div key={i} className="mu">{x}</div>)}
        {Array.from({ length: f }).map((_, i) => <div key={'e' + i} />)}
        {Array.from({ length: n }, (_, i) => { const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`; return <div key={k} className={'day ' + (has(k) ? 'has ' : '') + (k === sel ? 'sel' : '')} onClick={() => setSel(k)}>{i + 1}</div>; })}</div>
      <h3>{sel}</h3>
      {has(sel) ? CORE.concat(OPT).map(([k, label]) => { const v = d[k]; if (!v || !(v.body || v.url || (v.tags || []).length)) return null;
        return <div className="card" key={k}><b>{label}</b><div style={{ whiteSpace: 'pre-line' }}>{v.body}</div>{(v.tags || []).length > 0 && <div className="mu">{v.tags.join(', ')}</div>}{v.url && <img className="ph" src={v.url} alt="" />}</div>; })
        : <p className="mu">Nothing logged this day.</p>}
      <button className="p" onClick={() => setView('today')}>Open this day</button></>);
  };

  const Settings = () => (<><h1>Settings</h1>
    <div className="card"><h3>Theme</h3><div className="chips">{[['auto','Match device'],['light','Light'],['dark','Dark']].map(([k, l]) => <button key={k} className={'chip ' + (prof.theme === k ? 'on' : '')} onClick={() => setProfile({ theme: k })}>{l}</button>)}</div></div>
    <div className="card"><h3>Extra entries</h3>{OPT.map(([k, l]) => <div className="row" key={k}><span>{l}</span><input type="checkbox" checked={!!prof.extras[k]} onChange={e => setProfile({ extras: { ...prof.extras, [k]: e.target.checked } })} /></div>)}</div>
    <div className="card"><button onClick={() => sb.auth.signOut()}>Sign out</button></div></>);

  return (<><main>{view === 'today' ? Today() : view === 'cal' ? Cal() : Settings()}</main>
    <nav>{[['today','Today'],['cal','Calendar'],['set','Settings']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</nav></>);
    }

const SUPABASE_URL = 'https://nuwsczuwyezpodtnouqf.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51d3NjenV3eWV6cG9kdG5vdXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTExMTYsImV4cCI6MjEwMTk2NzExNn0.xqrEqaV9pfQchO7MDs6E-59wGDDIIqDLs5qVfsGwkQs';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function fmt(n) {
  const x = Number(n) || 0;
  if (x >= 1e9) return `${(x / 1e9).toFixed(1)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}k`;
  return String(x);
}

function when(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const gate = document.getElementById('gate');
const dash = document.getElementById('dash');
const signOut = document.getElementById('sign-out');
const note = document.getElementById('login-note');

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  note.className = 'note';
  note.textContent = 'Sending link…';
  const email = new FormData(e.target).get('email');
  const { error } = await sb.auth.signInWithOtp({
    email: String(email),
    options: { emailRedirectTo: window.location.origin + '/' },
  });
  if (error) {
    note.className = 'note err';
    note.textContent = error.message;
    return;
  }
  note.className = 'note ok';
  note.textContent = 'Check your email. Open the link on this machine.';
});

signOut.addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

async function loadDashboard() {
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData.session;
  if (!session) {
    gate.classList.remove('hidden');
    dash.classList.add('hidden');
    signOut.classList.add('hidden');
    return;
  }

  const { data: isAdmin, error: claimErr } = await sb.rpc('claim_site_admin');
  if (claimErr || isAdmin === false) {
    gate.classList.remove('hidden');
    dash.classList.add('hidden');
    note.className = 'note err';
    note.textContent = claimErr?.message || 'This account is not an admin. The first signed-in email becomes admin.';
    return;
  }

  const { data, error } = await sb.rpc('get_admin_dashboard');
  if (error) {
    gate.classList.remove('hidden');
    note.className = 'note err';
    note.textContent = error.message;
    return;
  }

  gate.classList.add('hidden');
  dash.classList.remove('hidden');
  signOut.classList.remove('hidden');
  render(data);
}

fetch('/api/releases/manifest.json')
  .then((r) => r.json())
  .then((m) => {
    const el = document.getElementById('app-version');
    if (el && m.latestVersion) {
      const commit = typeof m.commit === 'string' ? m.commit.slice(0, 7) : '';
      el.textContent = commit
        ? `Singularity ${m.latestVersion} (${commit})`
        : `Singularity ${m.latestVersion}`;
    }
  })
  .catch(() => {});

function render(d) {
  document.getElementById('who').textContent =
    `${d.admin} · generated ${when(d.generated_at)}`;

  const t = d.totals || {};
  const h = d.last_24h || {};
  const w = d.last_7d || {};
  document.getElementById('kpis').innerHTML = [
    ['Users', t.users, `${h.users} active 24h`],
    ['Devices', t.devices, `${w.users} active 7d`],
    ['Requests', t.requests, `${fmt(h.requests)} in 24h`],
    ['Tokens', fmt(t.tokens), `${fmt(h.tokens)} in 24h`],
  ].map(([l, v, s]) => `<div class="kpi"><div class="v">${v ?? 0}</div><div class="l">${l}</div><div class="l">${s}</div></div>`).join('');

  const daily = d.daily || [];
  const max = Math.max(1, ...daily.map((x) => Number(x.tokens) || 0));
  document.getElementById('chart').innerHTML = daily.length
    ? daily.map((x) => {
        const hgt = Math.max(4, Math.round((Number(x.tokens) / max) * 140));
        return `<div title="${x.day}: ${fmt(x.tokens)} tokens, ${x.requests} req"><div class="bar" style="height:${hgt}px"></div></div>`;
      }).join('')
    : '<p class="lede">No usage in the last 30 days yet.</p>';

  document.getElementById('models').innerHTML = (d.models || []).length
    ? d.models.map((m) => `<div class="model-row"><span>${m.model}</span><span>${fmt(m.tokens)} · ${m.requests}</span></div>`).join('')
    : '<p class="lede">No model mix yet.</p>';

  document.getElementById('users').innerHTML = (d.users || []).map((u) => `
    <tr>
      <td>${u.email}</td>
      <td>${fmt(u.tokens)}</td>
      <td>${u.requests}</td>
      <td>${u.devices}</td>
      <td>${when(u.last_seen_at)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">No users yet.</td></tr>';

  document.getElementById('recent').innerHTML = (d.recent || []).map((r) => `
    <tr>
      <td>${when(r.created_at)}</td>
      <td>${r.email}</td>
      <td>${r.model || '—'}</td>
      <td>${fmt(r.total_charged)}</td>
    </tr>
  `).join('') || '<tr><td colspan="4">No calls yet.</td></tr>';
}

sb.auth.onAuthStateChange(() => {
  void loadDashboard();
});
void loadDashboard();

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3333;

// Paths
const PROSPECTS_CSV = path.join(__dirname, '..', 'prospects', 'coaches-list.csv');
const TRACKING_FILE = path.join(__dirname, '..', 'email-outreach', 'outreach-tracking.json');
const LEADS_FILE = path.join(__dirname, 'leads-status.json');

app.use(express.json());

// Load CSV
function loadProspects() {
  const content = fs.readFileSync(PROSPECTS_CSV, 'utf8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = values[i]?.trim());
    return obj;
  });
}

// Load tracking
function loadTracking() {
  try {
    return JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf8'));
  } catch {
    return { prospects: {}, stats: {} };
  }
}

// Load lead statuses
function loadLeadStatuses() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveLeadStatuses(data) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(data, null, 2));
}

// API: Get all data
app.get('/api/leads', (req, res) => {
  const prospects = loadProspects();
  const tracking = loadTracking();
  const statuses = loadLeadStatuses();
  
  const leads = prospects.map(p => {
    const emailTrack = tracking.prospects[p.email] || {};
    const status = statuses[p.email] || { status: 'pending', notes: '' };
    return {
      ...p,
      emailSent: !!emailTrack.initial,
      sentDate: emailTrack.initial,
      followUp1: emailTrack.followUp1,
      followUp2: emailTrack.followUp2,
      ...status
    };
  });
  
  // Stats
  const stats = {
    total: leads.length,
    sent: leads.filter(l => l.emailSent).length,
    pending: leads.filter(l => !l.emailSent).length,
    replied: leads.filter(l => l.status === 'replied').length,
    interested: leads.filter(l => l.status === 'interested').length,
    booked: leads.filter(l => l.status === 'booked').length,
    notInterested: leads.filter(l => l.status === 'not_interested').length
  };
  
  res.json({ leads, stats });
});

// API: Update lead status
app.post('/api/leads/:email/status', (req, res) => {
  const { email } = req.params;
  const { status, notes } = req.body;
  const statuses = loadLeadStatuses();
  statuses[email] = { status, notes, updatedAt: new Date().toISOString() };
  saveLeadStatuses(statuses);
  res.json({ ok: true });
});

// Dashboard HTML
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>LeadSetter Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f1a; color: white; padding: 20px; }
    h1 { margin-bottom: 20px; }
    .stats { display: flex; gap: 15px; margin-bottom: 30px; flex-wrap: wrap; }
    .stat { background: #1a1a2e; padding: 20px 30px; border-radius: 10px; text-align: center; }
    .stat-num { font-size: 2rem; font-weight: bold; color: #667eea; }
    .stat-label { font-size: 0.9rem; color: #888; }
    .filters { margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; }
    .filters button { padding: 8px 16px; border: none; border-radius: 5px; cursor: pointer; background: #1a1a2e; color: white; }
    .filters button.active { background: #667eea; }
    table { width: 100%; border-collapse: collapse; background: #1a1a2e; border-radius: 10px; overflow: hidden; }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #2a2a3e; }
    th { background: #2a2a3e; font-weight: 600; }
    tr:hover { background: #252538; }
    .status-badge { padding: 4px 10px; border-radius: 15px; font-size: 0.8rem; font-weight: 500; }
    .status-pending { background: #4a4a5a; }
    .status-sent { background: #3b82f6; }
    .status-replied { background: #f59e0b; }
    .status-interested { background: #10b981; }
    .status-booked { background: #22c55e; }
    .status-not_interested { background: #ef4444; }
    select { padding: 5px; border-radius: 5px; background: #2a2a3e; color: white; border: 1px solid #4a4a5a; }
    .ig-link { color: #667eea; text-decoration: none; }
    .ig-link:hover { text-decoration: underline; }
    input[type="text"] { padding: 5px 10px; border-radius: 5px; background: #2a2a3e; color: white; border: 1px solid #4a4a5a; width: 150px; }
    .email-status { font-size: 0.75rem; color: #888; }
    .refresh-btn { background: #667eea; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>🚀 LeadSetter Dashboard</h1>
  <button class="refresh-btn" onclick="loadData()">↻ Refresh</button>
  
  <div class="stats" id="stats"></div>
  
  <div class="filters">
    <button class="active" data-filter="all">All</button>
    <button data-filter="sent">Sent</button>
    <button data-filter="pending">Pending</button>
    <button data-filter="replied">Replied</button>
    <button data-filter="interested">Interested</button>
    <button data-filter="booked">Booked</button>
    <button data-filter="not_interested">Not Interested</button>
  </div>
  
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Instagram</th>
        <th>Email</th>
        <th>Followers</th>
        <th>Niche</th>
        <th>Email Status</th>
        <th>Lead Status</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody id="leads"></tbody>
  </table>

  <script>
    let allLeads = [];
    let currentFilter = 'all';

    async function loadData() {
      const res = await fetch('/api/leads');
      const data = await res.json();
      allLeads = data.leads;
      renderStats(data.stats);
      renderLeads();
    }

    function renderStats(stats) {
      document.getElementById('stats').innerHTML = \`
        <div class="stat"><div class="stat-num">\${stats.total}</div><div class="stat-label">Total</div></div>
        <div class="stat"><div class="stat-num">\${stats.sent}</div><div class="stat-label">Emails Sent</div></div>
        <div class="stat"><div class="stat-num">\${stats.pending}</div><div class="stat-label">Pending</div></div>
        <div class="stat"><div class="stat-num">\${stats.replied}</div><div class="stat-label">Replied</div></div>
        <div class="stat"><div class="stat-num">\${stats.interested}</div><div class="stat-label">Interested</div></div>
        <div class="stat"><div class="stat-num">\${stats.booked}</div><div class="stat-label">Booked</div></div>
      \`;
    }

    function renderLeads() {
      let filtered = allLeads;
      if (currentFilter === 'sent') filtered = allLeads.filter(l => l.emailSent);
      else if (currentFilter === 'pending') filtered = allLeads.filter(l => !l.emailSent);
      else if (currentFilter !== 'all') filtered = allLeads.filter(l => l.status === currentFilter);

      document.getElementById('leads').innerHTML = filtered.map(l => \`
        <tr>
          <td>\${l.name}</td>
          <td><a class="ig-link" href="https://instagram.com/\${l.instagram?.replace('@','')}" target="_blank">\${l.instagram}</a></td>
          <td>\${l.email}</td>
          <td>\${l.followers}</td>
          <td>\${l.niche}</td>
          <td>
            \${l.emailSent ? '<span class="status-badge status-sent">Sent</span>' : '<span class="status-badge status-pending">Not Sent</span>'}
            \${l.followUp1 ? '<br><span class="email-status">F1 ✓</span>' : ''}
            \${l.followUp2 ? '<span class="email-status">F2 ✓</span>' : ''}
          </td>
          <td>
            <select onchange="updateStatus('\${l.email}', this.value)">
              <option value="pending" \${l.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="replied" \${l.status === 'replied' ? 'selected' : ''}>Replied</option>
              <option value="interested" \${l.status === 'interested' ? 'selected' : ''}>Interested</option>
              <option value="booked" \${l.status === 'booked' ? 'selected' : ''}>Booked</option>
              <option value="not_interested" \${l.status === 'not_interested' ? 'selected' : ''}>Not Interested</option>
            </select>
          </td>
          <td><input type="text" value="\${l.notes || ''}" onchange="updateNotes('\${l.email}', this.value)" placeholder="Add notes..."></td>
        </tr>
      \`).join('');
    }

    async function updateStatus(email, status) {
      const lead = allLeads.find(l => l.email === email);
      await fetch('/api/leads/' + encodeURIComponent(email) + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes: lead?.notes || '' })
      });
      loadData();
    }

    async function updateNotes(email, notes) {
      const lead = allLeads.find(l => l.email === email);
      await fetch('/api/leads/' + encodeURIComponent(email) + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: lead?.status || 'pending', notes })
      });
    }

    document.querySelectorAll('.filters button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filters button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderLeads();
      });
    });

    loadData();
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log('\n🚀 LeadSetter Dashboard running at http://localhost:' + PORT + '\n');
});

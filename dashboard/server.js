require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
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

// API: Send quick email to lead
app.post('/api/leads/:email/send', async (req, res) => {
  const { email } = req.params;
  const { subject, message } = req.body;
  
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    await resend.emails.send({
      from: 'Gavin from LeadSetter <gavin@lead-setter.com>',
      reply_to: 'gavinjoseph2@gmail.com',
      to: [email],
      subject: subject || 'Following up',
      html: message.replace(/\n/g, '<br>')
    });
    
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Mark as replied (for manual marking)
app.post('/api/leads/:email/replied', (req, res) => {
  const { email } = req.params;
  const statuses = loadLeadStatuses();
  statuses[email] = { 
    ...statuses[email], 
    status: 'replied', 
    repliedAt: new Date().toISOString() 
  };
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
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%);
      background-attachment: fixed;
      color: #e2e8f0; 
      padding: 30px; 
      min-height: 100vh;
    }
    h1 { 
      margin-bottom: 25px; 
      font-size: 2rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .stats { display: flex; gap: 15px; margin-bottom: 30px; flex-wrap: wrap; }
    .stat { 
      background: rgba(26, 26, 46, 0.8); 
      backdrop-filter: blur(10px);
      padding: 20px 30px; 
      border-radius: 16px; 
      text-align: center;
      border: 1px solid rgba(102, 126, 234, 0.2);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .stat:hover { 
      transform: translateY(-2px); 
      box-shadow: 0 8px 25px rgba(102, 126, 234, 0.2);
    }
    .stat-num { font-size: 2.2rem; font-weight: bold; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .stat-label { font-size: 0.85rem; color: #8892b0; margin-top: 5px; }
    .filters { margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap; }
    .filters button { 
      padding: 10px 18px; 
      border: none; 
      border-radius: 8px; 
      cursor: pointer; 
      background: rgba(26, 26, 46, 0.8); 
      color: #8892b0; 
      font-weight: 500;
      transition: all 0.2s;
      border: 1px solid transparent;
    }
    .filters button:hover { background: rgba(102, 126, 234, 0.2); color: #e2e8f0; }
    .filters button.active { 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      color: white;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      background: rgba(26, 26, 46, 0.6); 
      backdrop-filter: blur(10px);
      border-radius: 16px; 
      overflow: hidden;
      border: 1px solid rgba(102, 126, 234, 0.1);
    }
    th, td { padding: 14px 18px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
    th { background: rgba(42, 42, 62, 0.8); font-weight: 600; color: #a0aec0; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px; }
    tr { transition: background 0.2s; }
    tr:hover { background: rgba(102, 126, 234, 0.1); }
    .status-badge { padding: 5px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .status-pending { background: rgba(74, 74, 90, 0.5); color: #8892b0; }
    .status-sent { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .status-replied { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .status-interested { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .status-booked { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
    .status-not_interested { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    select { 
      padding: 8px 12px; 
      border-radius: 8px; 
      background: rgba(42, 42, 62, 0.8); 
      color: #e2e8f0; 
      border: 1px solid rgba(102, 126, 234, 0.3);
      cursor: pointer;
    }
    select:focus { outline: none; border-color: #667eea; }
    .ig-link { color: #818cf8; text-decoration: none; font-weight: 500; }
    .ig-link:hover { color: #a5b4fc; text-decoration: underline; }
    input[type="text"] { 
      padding: 8px 12px; 
      border-radius: 8px; 
      background: rgba(42, 42, 62, 0.8); 
      color: #e2e8f0; 
      border: 1px solid rgba(102, 126, 234, 0.3); 
      width: 150px;
    }
    input[type="text"]:focus { outline: none; border-color: #667eea; }
    input[type="text"]::placeholder { color: #4a5568; }
    .email-status { font-size: 0.7rem; color: #10b981; margin-top: 4px; }
    .refresh-btn { 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      color: white; 
      padding: 12px 24px; 
      border: none; 
      border-radius: 10px; 
      cursor: pointer; 
      margin-bottom: 25px;
      font-weight: 600;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .refresh-btn:hover { 
      transform: translateY(-2px); 
      box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
    }
    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #1a1a2e; }
    ::-webkit-scrollbar-thumb { background: #667eea; border-radius: 4px; }
    
    /* Action buttons */
    .action-btn {
      background: rgba(102, 126, 234, 0.2);
      border: none;
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
      margin-right: 5px;
      transition: all 0.2s;
    }
    .action-btn:hover { background: rgba(102, 126, 234, 0.4); transform: scale(1.1); }
    .reply-btn:hover { background: rgba(16, 185, 129, 0.4); }
    
    /* Modal */
    .modal {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.8);
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }
    .modal.active { display: flex; }
    .modal-content {
      background: #1a1a2e;
      padding: 30px;
      border-radius: 16px;
      width: 500px;
      max-width: 90%;
      border: 1px solid rgba(102, 126, 234, 0.3);
    }
    .modal h3 { margin-bottom: 20px; color: #e2e8f0; }
    .modal input, .modal textarea {
      width: 100%;
      padding: 12px;
      margin-bottom: 15px;
      border-radius: 8px;
      background: rgba(42, 42, 62, 0.8);
      color: #e2e8f0;
      border: 1px solid rgba(102, 126, 234, 0.3);
    }
    .modal textarea { min-height: 150px; resize: vertical; }
    .modal-buttons { display: flex; gap: 10px; justify-content: flex-end; }
    .modal-btn {
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-weight: 600;
    }
    .modal-btn.send { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
    .modal-btn.cancel { background: rgba(42, 42, 62, 0.8); color: #8892b0; }
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
  
  <!-- Email Modal -->
  <div class="modal" id="emailModal">
    <div class="modal-content">
      <h3>📧 Send Email to <span id="modalRecipient"></span></h3>
      <input type="text" id="emailSubject" placeholder="Subject" value="Quick follow up">
      <textarea id="emailBody" placeholder="Your message...">Hey!

Just wanted to follow up on my previous email about the AI appointment setter.

Did you get a chance to check out the demo?

Let me know if you have any questions!

Gavin</textarea>
      <div class="modal-buttons">
        <button class="modal-btn cancel" onclick="closeEmailModal()">Cancel</button>
        <button class="modal-btn send" onclick="sendEmail()">Send Email</button>
      </div>
    </div>
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
        <th>Actions</th>
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
          <td>
            <button class="action-btn email-btn" onclick="openEmailModal('\${l.email}', '\${l.name}')">📧</button>
            <button class="action-btn reply-btn" onclick="markReplied('\${l.email}')" title="Mark as replied">↩️</button>
          </td>
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

    let currentEmailTarget = '';
    
    function openEmailModal(email, name) {
      currentEmailTarget = email;
      document.getElementById('modalRecipient').textContent = name || email;
      document.getElementById('emailModal').classList.add('active');
    }
    
    function closeEmailModal() {
      document.getElementById('emailModal').classList.remove('active');
    }
    
    async function sendEmail() {
      const subject = document.getElementById('emailSubject').value;
      const message = document.getElementById('emailBody').value;
      
      try {
        const res = await fetch('/api/leads/' + encodeURIComponent(currentEmailTarget) + '/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject, message })
        });
        if (res.ok) {
          alert('Email sent!');
          closeEmailModal();
        } else {
          alert('Failed to send email');
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }
    
    async function markReplied(email) {
      await fetch('/api/leads/' + encodeURIComponent(email) + '/replied', { method: 'POST' });
      loadData();
    }
    
    loadData();
    // Auto-refresh every 30 seconds
    setInterval(loadData, 30000);
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log('\n🚀 LeadSetter Dashboard running at http://localhost:' + PORT + '\n');
});

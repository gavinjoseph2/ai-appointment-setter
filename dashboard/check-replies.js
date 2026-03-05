/**
 * Auto-detect replies to LeadSetter outreach emails
 * Only checks for replies from prospects in our list
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

// Gmail credentials
const GMAIL_USER = 'gavinjoseph2@gmail.com';
const GMAIL_APP_PASSWORD = 'unvl anef nuzq tgbl'; // From TOOLS.md

// Files
const PROSPECTS_CSV = path.join(__dirname, '..', 'prospects', 'coaches-list.csv');
const LEADS_STATUS_FILE = path.join(__dirname, 'leads-status.json');
const REPLIES_LOG = path.join(__dirname, 'replies-log.json');

// Load prospect emails
function getProspectEmails() {
  const content = fs.readFileSync(PROSPECTS_CSV, 'utf8');
  const lines = content.trim().split('\n').slice(1);
  const emails = new Set();
  lines.forEach(line => {
    const parts = line.split(',');
    if (parts[2]) emails.add(parts[2].trim().toLowerCase());
  });
  return emails;
}

// Load/save leads status
function loadLeadStatuses() {
  try {
    return JSON.parse(fs.readFileSync(LEADS_STATUS_FILE, 'utf8'));
  } catch { return {}; }
}

function saveLeadStatuses(data) {
  fs.writeFileSync(LEADS_STATUS_FILE, JSON.stringify(data, null, 2));
}

// Load/save replies log
function loadRepliesLog() {
  try {
    return JSON.parse(fs.readFileSync(REPLIES_LOG, 'utf8'));
  } catch { return { seen: [], replies: [] }; }
}

function saveRepliesLog(data) {
  fs.writeFileSync(REPLIES_LOG, JSON.stringify(data, null, 2));
}

// Check Gmail for replies
async function checkForReplies() {
  const prospectEmails = getProspectEmails();
  const repliesLog = loadRepliesLog();
  const statuses = loadLeadStatuses();
  
  console.log(`\n📧 Checking for replies from ${prospectEmails.size} prospects...`);

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: GMAIL_USER,
      password: GMAIL_APP_PASSWORD,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('Error opening inbox:', err);
          imap.end();
          return reject(err);
        }

        // Search ONLY for emails TO lead-setter.com (replies to our outreach)
        const since = new Date();
        since.setDate(since.getDate() - 7);
        
        // Search for emails sent TO lead-setter addresses (these are replies)
        imap.search([['SINCE', since], ['TO', '@lead-setter.com']], (err, results) => {
          if (err || !results.length) {
            console.log('No new emails found');
            imap.end();
            return resolve({ newReplies: 0 });
          }

          console.log(`Found ${results.length} recent emails, checking for prospect replies...`);

          const fetch = imap.fetch(results, { bodies: '', struct: true });
          let newReplies = 0;

          fetch.on('message', (msg, seqno) => {
            msg.on('body', (stream, info) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;

                const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase();
                const subject = parsed.subject || '';
                const messageId = parsed.messageId;
                const date = parsed.date;

                // Skip if already processed
                if (repliesLog.seen.includes(messageId)) return;

                // Check if from a prospect
                if (fromEmail && prospectEmails.has(fromEmail)) {
                  console.log(`✅ Reply from prospect: ${fromEmail}`);
                  console.log(`   Subject: ${subject}`);
                  console.log(`   Date: ${date}`);

                  // Update status
                  statuses[fromEmail] = {
                    ...statuses[fromEmail],
                    status: 'replied',
                    repliedAt: date?.toISOString() || new Date().toISOString(),
                    replySubject: subject,
                    replyPreview: (parsed.text || '').slice(0, 200)
                  };

                  repliesLog.replies.push({
                    from: fromEmail,
                    subject,
                    date: date?.toISOString(),
                    messageId
                  });

                  newReplies++;
                }

                // Mark as seen
                repliesLog.seen.push(messageId);
              });
            });
          });

          fetch.once('end', () => {
            saveLeadStatuses(statuses);
            saveRepliesLog(repliesLog);
            console.log(`\n✅ Done! Found ${newReplies} new replies.`);
            imap.end();
            resolve({ newReplies });
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.error('IMAP error:', err);
      reject(err);
    });

    imap.connect();
  });
}

// Run if called directly
if (require.main === module) {
  checkForReplies()
    .then(result => {
      console.log('Result:', result);
      process.exit(0);
    })
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

module.exports = { checkForReplies };

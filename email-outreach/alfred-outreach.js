/**
 * Alfred's Automated Email Outreach
 * Runs autonomously via cron - sends initial emails + follow-ups
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

// Config
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'alfred@lead-setter.com';
const FROM_NAME = 'Gavin | LeadSetter';
const GAVIN_EMAIL = 'gavinjoseph2@gmail.com';
const DAILY_LIMIT = 20; // Max emails per run
const FOLLOWUP_1_DAYS = 3;
const FOLLOWUP_2_DAYS = 7;

// Pain point map by niche keyword
function getPainPoint(niche) {
  const n = (niche || '').toLowerCase();

  if (n.includes('sales') || n.includes('premium client') || n.includes('business scal') || n.includes('business coach')) {
    return {
      pain: `You're probably hopping on discovery calls that go nowhere — or worse, losing people who were ready but never heard back fast enough.`,
      solution: `What I built qualifies leads before they ever reach you, so the only calls you're taking are with people who are already serious.`
    };
  }
  if (n.includes('life coach') || n.includes('mindset') || n.includes('trauma') || n.includes('healer') || n.includes('wellness') || n.includes('anxiety')) {
    return {
      pain: `People in your space take time to commit — they lurk, they follow, they feel the pull, but they need a nudge before they actually book. Most coaches lose them in that window.`,
      solution: `What I built follows up with those people automatically — in a way that feels personal, not spammy — and gets them to take the next step when they're ready.`
    };
  }
  if (n.includes('ig growth') || n.includes('instagram') || n.includes('content') || n.includes('social')) {
    return {
      pain: `You probably help clients grow their audience — but leads coming from your own content likely aren't converting at the rate they could be.`,
      solution: `I built something that catches the people who engage with your content, follows up automatically, and books them before they lose momentum.`
    };
  }
  if (n.includes('health') || n.includes('fitness') || n.includes('diet') || n.includes('nutrition') || n.includes('autoimmune')) {
    return {
      pain: `People follow you because they want to change their health. But wanting to change and actually booking are two different things — and most of them just need a nudge they never get.`,
      solution: `What I built sends that nudge automatically — follows up, qualifies them, and books the ones who are serious.`
    };
  }
  if (n.includes('online business') || n.includes('online expert') || n.includes('course') || n.includes('digital product') || n.includes('launch')) {
    return {
      pain: `The gap between someone clicking your link and actually booking a call is where most of the revenue leaks. Most people need 2-3 follow-ups before they commit — and nobody has time to send those manually.`,
      solution: `I built a tool that closes that gap automatically. It follows up, qualifies, and books — without you lifting a finger.`
    };
  }
  if (n.includes('relationship') || n.includes('marriage') || n.includes('dating')) {
    return {
      pain: `People in your niche are dealing with real emotional stuff — they don't book right away. They think about it, put it off, and eventually move on. You lose them not because they weren't interested, but because no one followed up.`,
      solution: `What I built reaches back out to those people automatically, meets them where they are, and books the call when they're finally ready.`
    };
  }
  if (n.includes('performance') || n.includes('executive') || n.includes('high-achiev') || n.includes('leadership')) {
    return {
      pain: `High-achievers are busy. They see your stuff, they mean to reach out, and then something else pulls their attention. Most of them would've booked — they just needed a timely follow-up.`,
      solution: `What I built handles that follow-up automatically, so you're capturing the leads that would've otherwise slipped through.`
    };
  }

  // Default fallback
  return {
    pain: `Most coaches I talk to are great at attracting interest — the problem is converting that interest into booked calls. People show up, click around, and then disappear before taking the next step.`,
    solution: `What I built closes that gap. It follows up with those leads automatically, figures out who's serious, and gets them booked without you chasing anyone.`
  };
}

// Email templates
const templates = {
  initial: (name, niche, notes, instagram) => {
    const { pain, solution } = getPainPoint(niche);
    return {
      subject: `had a question`,
      html: `
        <p>Hey ${name},</p>

        <p>${pain}</p>

        <p>${solution}</p>

        <p>Made a quick 2-min video if you want to see exactly how it works: <a href="https://www.loom.com/share/86489f9c9db04641baa4c12c02a1b944">loom.com/share/86489f9c</a></p>

        <p>Either way, keep doing what you're doing.</p>

        <p>Gavin</p>
      `
    };
  },

  followUp1: (name, niche) => {
    const { pain } = getPainPoint(niche);
    return {
      subject: `re: had a question`,
      html: `
        <p>Hey ${name},</p>

        <p>Wanted to follow up on my last email — I'll be more direct this time.</p>

        <p>${pain}</p>

        <p>I work with coaches specifically on this problem. Not traffic, not content — just fixing the leak between "interested" and "booked."</p>

        <p>If it's relevant, happy to do a quick 15-min screen share. No pitch, just showing you what it looks like in practice.</p>

        <p>Gavin</p>
      `
    };
  },

  followUp2: (name) => ({
    subject: `last one, promise`,
    html: `
      <p>Hey ${name},</p>

      <p>Not going to keep showing up in your inbox after this.</p>

      <p>If the timing's off or it's just not relevant, totally fair. But if you ever find yourself thinking "I know I'm losing leads somewhere" — that's exactly what I help with.</p>

      <p>Demo's here whenever: <a href="https://www.loom.com/share/86489f9c9db04641baa4c12c02a1b944">loom.com/share/86489f9c</a></p>

      <p>Hope things are going well.</p>

      <p>Gavin</p>
    `
  })
};

// Tracking file
const TRACKING_FILE = path.join(__dirname, 'outreach-tracking.json');

function loadTracking() {
  try {
    return JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf8'));
  } catch {
    return { 
      prospects: {}, // email -> { initial: date, followUp1: date, followUp2: date }
      stats: { sent: 0, bounced: 0, replies: 0 }
    };
  }
}

function saveTracking(data) {
  fs.writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2));
}

// Parse prospects CSV
function parseProspects() {
  const csvPath = path.join(__dirname, '..', 'prospects', 'coaches-list.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = values[i]?.trim());
    return obj;
  }).filter(p => p.email && !p.email.includes('gmail.com')); // Skip generic gmails
}

// Send email
async function sendEmail(resend, to, template, type) {
  try {
    const result = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      reply_to: FROM_EMAIL,
      to: [to],
      subject: template.subject,
      html: template.html
    });
    console.log(`✅ [${type}] Sent to ${to}`);
    return { success: true, id: result.id };
  } catch (error) {
    console.error(`❌ [${type}] Failed ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

// Notify Gavin of activity
async function notifyGavin(resend, summary) {
  await resend.emails.send({
    from: `LeadSetter Reports <gavin@lead-setter.com>`,
    to: [GAVIN_EMAIL],
    subject: `📧 Outreach Report - ${new Date().toLocaleDateString()}`,
    html: `
      <h2>LeadSetter Outreach Report</h2>
      <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
      <h3>Today's Activity:</h3>
      <ul>
        <li>Initial emails sent: ${summary.initial}</li>
        <li>Follow-up 1 sent: ${summary.followUp1}</li>
        <li>Follow-up 2 sent: ${summary.followUp2}</li>
        <li>Skipped (already done): ${summary.skipped}</li>
      </ul>
      <p><em>Check Resend dashboard for delivery status. Replies to alfred@lead-setter.com forward to your Gmail.</em></p>
    `
  });
}

// Calculate days since date
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

// Delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Main function
async function main() {
  console.log(`\n🤖 Alfred's Automated Outreach`);
  console.log(`Time: ${new Date().toLocaleString()}\n`);
  
  const resend = new Resend(RESEND_API_KEY);
  const prospects = parseProspects();
  const tracking = loadTracking();
  
  const summary = { initial: 0, followUp1: 0, followUp2: 0, skipped: 0 };
  let emailsSent = 0;
  
  for (const prospect of prospects) {
    if (emailsSent >= DAILY_LIMIT) {
      console.log(`\n⏸️ Daily limit (${DAILY_LIMIT}) reached. Continuing tomorrow.`);
      break;
    }
    
    const email = prospect.email;
    const record = tracking.prospects[email] || {};
    
    // Determine what to send
    if (!record.initial) {
      // Send initial email
      const template = templates.initial(prospect.name, prospect.niche, prospect.notes, prospect.instagram);
      const result = await sendEmail(resend, email, template, 'INITIAL');
      if (result.success) {
        tracking.prospects[email] = { ...record, initial: new Date().toISOString() };
        summary.initial++;
        emailsSent++;
      }
    } else if (!record.followUp1 && daysSince(record.initial) >= FOLLOWUP_1_DAYS) {
      // Send follow-up 1
      const template = templates.followUp1(prospect.name, prospect.niche);
      const result = await sendEmail(resend, email, template, 'FOLLOW-UP 1');
      if (result.success) {
        tracking.prospects[email] = { ...record, followUp1: new Date().toISOString() };
        summary.followUp1++;
        emailsSent++;
      }
    } else if (!record.followUp2 && record.followUp1 && daysSince(record.followUp1) >= (FOLLOWUP_2_DAYS - FOLLOWUP_1_DAYS)) {
      // Send follow-up 2
      const template = templates.followUp2(prospect.name);
      const result = await sendEmail(resend, email, template, 'FOLLOW-UP 2');
      if (result.success) {
        tracking.prospects[email] = { ...record, followUp2: new Date().toISOString() };
        summary.followUp2++;
        emailsSent++;
      }
    } else {
      summary.skipped++;
    }
    
    saveTracking(tracking);
    
    if (emailsSent > 0 && emailsSent % 5 === 0) {
      await delay(10000); // 10 sec pause every 5 emails
    }
  }
  
  // Notify Gavin if any activity
  if (summary.initial + summary.followUp1 + summary.followUp2 > 0) {
    await notifyGavin(resend, summary);
    console.log(`\n📬 Report sent to Gavin`);
  }
  
  console.log(`\n✅ Done! Sent ${emailsSent} emails total.`);
  console.log(`   Initial: ${summary.initial}, Follow-up 1: ${summary.followUp1}, Follow-up 2: ${summary.followUp2}`);
}

main().catch(console.error);

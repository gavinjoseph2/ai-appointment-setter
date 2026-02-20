require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

// Config from .env
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'gavin@lead-setter.com';
const FROM_NAME = 'Gavin';
const DELAY_BETWEEN_EMAILS = 30000; // 30 seconds between emails

// Email templates
const templates = {
  initial: (name, niche) => ({
    subject: `Quick question about ${niche || 'your coaching business'}`,
    html: `
      <p>Hey ${name},</p>
      
      <p>I came across your Instagram and love what you're doing with ${niche || 'coaching'}.</p>
      
      <p>Quick question - how are you currently handling lead qualification and booking calls?</p>
      
      <p>I built an AI appointment setter that qualifies leads 24/7 and books them directly into Calendly. It's already working for coaches in your space.</p>
      
      <p>Here's a 2-min demo: <a href="https://lead-setter.com">lead-setter.com</a></p>
      
      <p>Would love to give you a free trial if you're interested. No strings attached - just want feedback from someone doing great work.</p>
      
      <p>Best,<br>Gavin</p>
      
      <p style="color: #666; font-size: 12px;">P.S. The bot handles the "is this a good fit?" conversation so you only talk to qualified leads.</p>
    `
  }),
  
  followUp1: (name) => ({
    subject: `Re: Quick question`,
    html: `
      <p>Hey ${name},</p>
      
      <p>Just bumping this up - wanted to make sure you saw my last email.</p>
      
      <p>I know you're busy, so here's the short version: I have an AI that books qualified calls for coaches. Free to try, takes 5 min to set up.</p>
      
      <p>Worth a quick look?</p>
      
      <p>Gavin</p>
    `
  }),
  
  followUp2: (name) => ({
    subject: `One more thing`,
    html: `
      <p>Hey ${name},</p>
      
      <p>Last email from me on this - don't want to be annoying!</p>
      
      <p>If timing isn't right, totally get it. But if you're ever curious about automating lead qualification, the offer for a free trial stands.</p>
      
      <p>Here if you need it: <a href="https://lead-setter.com">lead-setter.com</a></p>
      
      <p>Wishing you success either way 🙏</p>
      
      <p>Gavin</p>
    `
  })
};

// Track sent emails
const SENT_FILE = path.join(__dirname, 'sent-emails.json');

function loadSentEmails() {
  try {
    return JSON.parse(fs.readFileSync(SENT_FILE, 'utf8'));
  } catch {
    return { sent: [], followUp1: [], followUp2: [] };
  }
}

function saveSentEmails(data) {
  fs.writeFileSync(SENT_FILE, JSON.stringify(data, null, 2));
}

// Parse CSV
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
  });
}

// Send email
async function sendEmail(resend, to, template) {
  try {
    const result = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject: template.subject,
      html: template.html
    });
    console.log(`✅ Sent to ${to}: ${result.id}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send to ${to}:`, error.message);
    return false;
  }
}

// Delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Main function
async function main() {
  const isPreview = process.argv.includes('--preview');
  const prospects = parseProspects();
  const sent = loadSentEmails();
  
  console.log(`\n📧 Email Outreach System`);
  console.log(`Found ${prospects.length} prospects\n`);
  
  if (isPreview) {
    console.log('PREVIEW MODE - no emails will be sent\n');
    prospects.forEach(p => {
      console.log(`${p.name} (${p.instagram})`);
      console.log(`  Email: ${p.email}`);
      console.log(`  Niche: ${p.niche}`);
      console.log(`  Status: ${sent.sent.includes(p.email) ? 'Already sent' : 'Not sent'}`);
      console.log('');
    });
    return;
  }
  
  const resend = new Resend(RESEND_API_KEY);
  
  for (const prospect of prospects) {
    if (!prospect.email || prospect.email === 'contact@gmail.com') {
      console.log(`⏭️ Skipping ${prospect.name} - no valid email`);
      continue;
    }
    
    if (sent.sent.includes(prospect.email)) {
      console.log(`⏭️ Skipping ${prospect.name} - already sent`);
      continue;
    }
    
    const template = templates.initial(prospect.name, prospect.niche);
    const success = await sendEmail(resend, prospect.email, template);
    
    if (success) {
      sent.sent.push(prospect.email);
      saveSentEmails(sent);
    }
    
    await delay(DELAY_BETWEEN_EMAILS);
  }
  
  console.log('\n✅ Done! Sent emails tracked in sent-emails.json');
}

main().catch(console.error);

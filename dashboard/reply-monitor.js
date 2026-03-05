/**
 * Reply Monitor - checks for prospect replies and reports results
 * Designed to be run via OpenClaw cron - Alfred will relay WhatsApp alert
 */

const { checkForReplies } = require('./check-replies');

async function main() {
  try {
    const result = await checkForReplies();

    if (result.newReplies > 0) {
      // Load replies to show details
      const fs = require('fs');
      const path = require('path');
      const repliesLog = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'replies-log.json'), 'utf8')
      );

      const recent = repliesLog.replies.slice(-result.newReplies);
      const lines = recent.map(r =>
        `• ${r.from}\n  "${r.subject}"`
      ).join('\n');

      console.log(`REPLY_ALERT:${result.newReplies}`);
      console.log(lines);
    } else {
      console.log(`REPLY_CHECK_OK:0`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Monitor error:', err.message);
    process.exit(1);
  }
}

main();

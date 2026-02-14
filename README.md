# AAA Appointment Setter Bot 🤖

An AI-powered appointment booking chatbot for coaches and consultants.

## Features

- 💬 Natural AI conversations (powered by Claude)
- 📅 Real-time calendar integration (Cal.com)
- 🎨 Customizable widget (colors, name, personality)
- 📱 Mobile responsive
- ⚡ Easy to embed on any website

## Quick Start

### 1. Install dependencies

```bash
cd aaa-bot
npm install
```

### 2. Configure environment

Copy the example config and add your API keys:

```bash
cp .env.example .env
```

Edit `.env` with your keys:

```
ANTHROPIC_API_KEY=sk-ant-xxxxx     # Get from console.anthropic.com
CALCOM_API_KEY=cal_live_xxxxx       # Get from cal.com/settings/developer/api-keys
CALCOM_EVENT_TYPE_ID=123456         # Your event type ID from Cal.com
BUSINESS_NAME=Coach Smith           # Client's business name
ASSISTANT_NAME=Alex                 # Bot's name
```

### 3. Run the bot

```bash
npm start
```

Visit `http://localhost:3456` to see the demo!

## Getting API Keys

### Anthropic (Claude)
1. Go to https://console.anthropic.com
2. Create an API key
3. Add to `.env` as `ANTHROPIC_API_KEY`

### Cal.com (Optional - for real bookings)
1. Create account at https://cal.com
2. Go to Settings → Developer → API Keys
3. Create new key
4. Get your Event Type ID from the URL when editing an event type
5. Add both to `.env`

**Note:** Without Cal.com configured, the bot runs in demo mode with fake availability.

## Embedding on Client Websites

Give clients this code to add to their website (before `</body>`):

```html
<!-- AAA Appointment Bot -->
<script>
  window.AAA_CONFIG = {
    apiUrl: 'https://your-server.com',  // Your hosted server URL
    assistantName: 'Alex',
    businessName: 'Coach Smith',
    primaryColor: '#1e40af',
    greeting: "Hi! I'm Alex. Ready to book your free consultation?"
  };
</script>
<link rel="stylesheet" href="https://your-server.com/style.css">
<script src="https://your-server.com/widget.js"></script>
```

## Customization

### Colors
Change `primaryColor` in the config to match client branding.

### Personality
Edit the `SYSTEM_PROMPT` in `server.js` to adjust:
- Tone and voice
- Qualifying questions
- Conversation flow

### Appearance
Edit `widget/style.css` for deeper visual customization.

## Production Deployment

For production, you'll want to:

1. **Host on a server** - DigitalOcean, Railway, Render, or any Node.js host
2. **Use HTTPS** - Required for embedding on HTTPS sites
3. **Add rate limiting** - Prevent abuse
4. **Use a database** - Replace in-memory conversation storage with Redis/PostgreSQL
5. **Add analytics** - Track conversations, bookings, conversion rates

## Cost Estimate

- **Claude API**: ~$0.003-0.01 per conversation (very cheap)
- **Cal.com**: Free tier available, or $12/mo for pro
- **Hosting**: $5-10/mo on Railway/Render

**Total: ~$5-20/mo per client** at low volume

## File Structure

```
aaa-bot/
├── server.js          # Main Express server + AI logic
├── .env.example       # Environment template
├── package.json       # Dependencies
├── README.md          # This file
└── widget/
    ├── demo.html      # Demo page
    ├── style.css      # Widget styles
    └── widget.js      # Embeddable widget
```

## License

Built for the AAA (AI Automation Agency) project.

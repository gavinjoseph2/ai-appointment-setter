require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk').default;
const path = require('path');
const nodemailer = require('nodemailer');

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS  // Use App Password for Gmail
  }
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'widget')));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Store conversations in memory (use Redis/DB in production)
const conversations = new Map();

// Cache for Calendly event type (auto-fetched from API key)
let cachedEventTypeUri = process.env.CALENDLY_EVENT_TYPE_URI || null;
let cachedSchedulingUrl = process.env.CALENDLY_SCHEDULING_URL || null;

// Auto-fetch Calendly event type on startup
async function initCalendly() {
  if (!process.env.CALENDLY_API_KEY) {
    console.log('⚠️  No Calendly API key - using mock data');
    return;
  }
  
  // If we already have the event type URI, skip fetching
  if (cachedEventTypeUri && cachedSchedulingUrl) {
    console.log('✅ Calendly configured from .env');
    return;
  }
  
  try {
    // First get the current user
    const userRes = await fetch('https://api.calendly.com/users/me', {
      headers: { 'Authorization': 'Bearer ' + process.env.CALENDLY_API_KEY }
    });
    const userData = await userRes.json();
    
    if (!userData.resource) {
      console.log('⚠️  Could not fetch Calendly user');
      return;
    }
    
    const userUri = userData.resource.uri;
    
    // Then get their event types
    const eventsRes = await fetch(`https://api.calendly.com/event_types?user=${encodeURIComponent(userUri)}&active=true`, {
      headers: { 'Authorization': 'Bearer ' + process.env.CALENDLY_API_KEY }
    });
    const eventsData = await eventsRes.json();
    
    if (eventsData.collection && eventsData.collection.length > 0) {
      // Use the first active event type
      const eventType = eventsData.collection[0];
      cachedEventTypeUri = eventType.uri;
      cachedSchedulingUrl = eventType.scheduling_url;
      console.log(`✅ Calendly auto-configured: "${eventType.name}"`);
      console.log(`   Event URI: ${cachedEventTypeUri}`);
      console.log(`   Booking URL: ${cachedSchedulingUrl}`);
    } else {
      console.log('⚠️  No active Calendly event types found');
    }
  } catch (error) {
    console.error('Calendly init error:', error.message);
  }
}

// System prompt for the appointment setter
const SYSTEM_PROMPT = `You are ${process.env.ASSISTANT_NAME || 'Alex'}, a friendly and professional appointment scheduling assistant for ${process.env.BUSINESS_NAME || 'our coaching practice'}.

Your goal is to:
1. Warmly greet visitors
2. Briefly qualify them with 2-3 questions
3. Help them book a free consultation call

CONVERSATION FLOW:
1. GREETING: Welcome them warmly, ask what brought them here today
2. QUALIFY: Ask about their main challenge/goal, and what they're hoping to achieve
3. BOOK: Once qualified, offer to book a consultation. Ask for their preferred day/time
4. COLLECT: Get their name, email, and phone number
5. CONFIRM: Confirm the booking details

RULES:
- Keep responses SHORT (2-3 sentences max)
- Be warm but professional
- Don't be pushy
- If they're not a good fit or not ready, be gracious
- Use get_availability to check available slots
- Use generate_booking_link when you have their name and email to send them a booking link

BOOKING FLOW:
1. Check availability with get_availability
2. Collect their name and email
3. Generate their personal booking link with generate_booking_link - IMPORTANT: Include a brief summary of what you learned about them (their goal, challenges, any relevant details) in the leadSummary field
4. Share the link - they'll complete the booking on Calendly

Available times are typically Monday-Friday, 11am-5pm EST.`;

// Calendly API functions
async function getCalendlyAvailability() {
  if (!process.env.CALENDLY_API_KEY || !cachedEventTypeUri) {
    // Return mock data if Calendly not configured
    return {
      available: true,
      slots: [
        { time: "Monday 11:00 AM" },
        { time: "Monday 2:00 PM" },
        { time: "Tuesday 11:00 AM" },
        { time: "Wednesday 3:00 PM" },
        { time: "Thursday 11:00 AM" },
        { time: "Friday 1:00 PM" }
      ]
    };
  }

  try {
    // Calendly requires start_time to be in the future and max 7 days range
    const now = new Date();
    const startTime = new Date(now.getTime() + 60000).toISOString(); // 1 minute from now
    const endTime = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(); // 6 days from now
    
    const url = `https://api.calendly.com/event_type_available_times?event_type=${encodeURIComponent(cachedEventTypeUri)}&start_time=${startTime}&end_time=${endTime}`;
    console.log('Fetching Calendly slots...');
    const response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + process.env.CALENDLY_API_KEY }
    });
    const data = await response.json();
    
    // Transform Calendly response to our format - group by day
    if (data.collection && data.collection.length > 0) {
      const slotsByDay = {};
      data.collection.forEach(slot => {
        const date = new Date(slot.start_time);
        const dayKey = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
        if (!slotsByDay[dayKey]) {
          slotsByDay[dayKey] = [];
        }
        const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
        slotsByDay[dayKey].push(time);
      });
      
      // Format as readable summary
      const daySummaries = Object.entries(slotsByDay).map(([day, times]) => {
        const firstTime = times[0];
        const lastTime = times[times.length - 1];
        return `${day}: ${firstTime} - ${lastTime} (${times.length} slots)`;
      });
      
      return { 
        available: true, 
        summary: daySummaries.join('\n'),
        days: Object.keys(slotsByDay),
        totalSlots: data.collection.length
      };
    }
    console.log('Calendly response:', JSON.stringify(data));
    return { available: false, slots: [], message: 'No available slots found' };
  } catch (error) {
    console.error('Calendly availability error:', error);
    return { error: 'Could not fetch availability' };
  }
}

async function generateBookingLink(name, email, leadSummary) {
  // Calendly doesn't support direct API booking on free tier
  // Instead, we generate a prefilled scheduling link
  const baseUrl = cachedSchedulingUrl || process.env.CALENDLY_SCHEDULING_URL || 'https://calendly.com/gavinjoseph2/30min';
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (email) params.set('email', email);
  
  const bookingUrl = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
  
  // Send email notification to coach (fire-and-forget, don't block response)
  if (process.env.EMAIL_USER && process.env.COACH_EMAIL) {
    transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.COACH_EMAIL,
        subject: `🎯 New Lead: ${name} is booking a call!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">New Lead Alert! 🎉</h2>
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
            </div>
            <h3 style="color: #1f2937;">Lead Summary:</h3>
            <div style="background: #fef3c7; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b;">
              <p style="margin: 0; white-space: pre-wrap;">${leadSummary || 'No summary provided'}</p>
            </div>
            <p style="color: #6b7280; margin-top: 20px; font-size: 14px;">
              They're completing their booking now. Check your Calendly for the confirmed time.
            </p>
          </div>
        `
      }).then(() => {
        console.log('📧 Lead notification sent to coach');
      }).catch(emailError => {
        console.error('Email error:', emailError);
        // Don't fail the booking if email fails
      });
  }
  
  return {
    success: true,
    booking_url: bookingUrl,
    message: `Great! Click here to complete your booking: ${bookingUrl}`
  };
}

// Tool definitions for Claude
const tools = [
  {
    name: "get_availability",
    description: "Get available appointment slots from Calendly. Call this when the user wants to know what times are available.",
    input_schema: {
      type: "object",
      properties: {
        week: {
          type: "string",
          description: "Which week to check: 'this_week' or 'next_week'"
        }
      },
      required: ["week"]
    }
  },
  {
    name: "generate_booking_link",
    description: "Generate a Calendly booking link and notify the coach. Call this when you have the client's name and email, and they're ready to book. Always include a summary of what you learned about them.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Client's full name" },
        email: { type: "string", description: "Client's email address" },
        leadSummary: { type: "string", description: "Brief summary of the lead: their goal, challenges, and any relevant context from the conversation" }
      },
      required: ["name", "email", "leadSummary"]
    }
  }
];

// Handle tool calls
async function handleToolCall(toolName, toolInput) {
  if (toolName === 'get_availability') {
    const availability = await getCalendlyAvailability();
    return JSON.stringify(availability);
  }
  
  if (toolName === 'generate_booking_link') {
    const result = await generateBookingLink(
      toolInput.name,
      toolInput.email,
      toolInput.leadSummary
    );
    return JSON.stringify(result);
  }
  
  return JSON.stringify({ error: 'Unknown tool' });
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message required' });
    }

    // Get or create conversation history
    if (!conversations.has(sessionId)) {
      conversations.set(sessionId, []);
    }
    const history = conversations.get(sessionId);
    
    // Add user message
    history.push({ role: 'user', content: message });

    // Call Claude
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      tools: tools,
      messages: history
    });

    // Handle tool use loop
    while (response.stop_reason === 'tool_use') {
      const toolUseBlock = response.content.find(block => block.type === 'tool_use');
      const toolResult = await handleToolCall(toolUseBlock.name, toolUseBlock.input);
      
      // Add assistant message with tool use
      history.push({ role: 'assistant', content: response.content });
      
      // Add tool result
      history.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseBlock.id,
          content: toolResult
        }]
      });

      // Get next response
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        tools: tools,
        messages: history
      });
    }

    // Extract text response
    const textContent = response.content.find(block => block.type === 'text');
    const assistantMessage = textContent ? textContent.text : "I'm sorry, I couldn't process that. Could you try again?";
    
    // Save to history
    history.push({ role: 'assistant', content: response.content });

    // Keep history manageable (last 20 messages)
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    res.json({ response: assistantMessage });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Setup/status endpoint - shows current config (useful for onboarding)
app.get('/api/setup', (req, res) => {
  res.json({
    status: 'ok',
    config: {
      businessName: process.env.BUSINESS_NAME || 'Not set',
      assistantName: process.env.ASSISTANT_NAME || 'Alex',
      coachEmail: process.env.COACH_EMAIL ? '✅ Configured' : '❌ Not set',
      calendly: {
        apiKey: process.env.CALENDLY_API_KEY ? '✅ Configured' : '❌ Not set',
        eventType: cachedEventTypeUri ? '✅ Auto-detected' : '❌ Not found',
        schedulingUrl: cachedSchedulingUrl || 'Not configured'
      },
      email: {
        configured: process.env.EMAIL_USER ? '✅ Ready' : '❌ Not set'
      }
    },
    embedCode: `<script>
  window.AAA_CONFIG = {
    apiUrl: '${process.env.BASE_URL || 'https://YOUR-BOT-URL.railway.app'}',
    assistantName: '${process.env.ASSISTANT_NAME || 'Alex'}',
    businessName: '${process.env.BUSINESS_NAME || 'Your Business'}'
  };
</script>
<script src="${process.env.BASE_URL || 'https://YOUR-BOT-URL.railway.app'}/widget.js"></script>`
  });
});

// Serve widget demo page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'widget', 'demo.html'));
});

const PORT = process.env.PORT || 3456;

// Initialize and start server
async function startServer() {
  await initCalendly();
  
  app.listen(PORT, () => {
    console.log(`🤖 Appointment Bot running on http://localhost:${PORT}`);
    console.log(`📱 Widget demo: http://localhost:${PORT}`);
    console.log(`💬 Chat API: http://localhost:${PORT}/api/chat`);
    console.log(`⚙️  Setup status: http://localhost:${PORT}/api/setup`);
  });
}

startServer();

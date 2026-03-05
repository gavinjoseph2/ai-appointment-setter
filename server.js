require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk').default;
const path = require('path');
const { Resend } = require('resend');

// Email setup with Resend
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
if (resend) {
  console.log('✅ Resend email configured');
} else {
  console.log('⚠️  No RESEND_API_KEY - email notifications disabled');
}

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
let cachedAvailableSlots = []; // Store full slot details for direct booking

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

Your goal is to help visitors book a free neuropathy strategy consultation call. First collect 4 quick intake questions, then book them in.

LANGUAGE RULE (VERY IMPORTANT):
- Your FIRST message must include the welcome greeting AND ask about Spanish.
- If user says YES to Spanish: switch entirely to Spanish for the rest of the conversation and never switch back to English.
- If user says NO: continue in English for the entire conversation.

FIRST MESSAGE (exactly):
"Welcome to Panda Physical Medicine! 🏥 I'm here to help you schedule your free neuropathy strategy consultation. Quick question — do you speak Spanish? (Yes/No)"

CONVERSATION FLOW:
1. INTAKE (ask each question ONE AT A TIME, wait for answer before moving to next):
   Q1: Spanish language question (in welcome message above) [if Yes → switch to Spanish from Q2 onward]
   User answers → then ask Q2
   Q2: "Have you been diagnosed with neuropathy before? (Yes/No)"
   User answers → then ask Q3
   Q3: "Have you found a solution to help your neuropathy? (Yes/No)"
   User answers → then ask Q4
   Q4: "On a scale of 1-5, how motivated are you to find a solution for your neuropathy?"

2. After all 4 answers collected → get availability and offer 3-4 times
3. Ask for name + email in the SAME message as the time options
4. Book immediately once you have time + name + email

RULES:
- Keep responses SHORT (1-2 sentences max)
- Ask questions ONE AT A TIME - never group them
- Wait for the user's answer to each question before moving to the next
- Be warm and conversational
- Show only 3-4 time options
- Include all 4 intake answers in the leadSummary when calling book_appointment

BOOKING FLOW:
1. Use get_availability (shows top 3-4 slots)
2. Present times AND ask for name/email in the SAME message
3. User responds → immediately call book_appointment
4. Done! Give them the confirmation link

EXAMPLE CONVERSATION:
Bot: "Welcome to Panda Physical Medicine! 🏥 I'm here to help you schedule your free neuropathy strategy consultation. Quick question — do you speak Spanish? (Yes/No)"
User: "No"
Bot: "Have you been diagnosed with neuropathy before? (Yes/No)"
User: "Yes"
Bot: "Have you found a solution to help your neuropathy? (Yes/No)"
User: "No"
Bot: "On a scale of 1-5, how motivated are you to find a solution for your neuropathy?"
User: "5"
Bot: [calls get_availability] "Great! I have Monday 11am, Tuesday 2pm, or Wednesday 11am open. Which works best? Just need your name and email to lock it in!"
Bot: "Great! I have Monday 2pm, Tuesday 11am, or Wednesday 3pm open. Which works? Just drop your name and email and I'll lock it in!"
User: "Tuesday 11am works. I'm John Smith, john@email.com"
Bot: [calls book_appointment] "Perfect! You're all set for Tuesday at 11am. Just confirm here: [link]. See you then! 🎉"

That's it - 2 messages to book. No lengthy qualification. Get them booked!

Available times: Monday-Friday, 11am-5pm EST.`;

// Calendly API functions
async function getCalendlyAvailability() {
  if (!process.env.CALENDLY_API_KEY || !cachedEventTypeUri) {
    // Return mock data if Calendly not configured — use dynamic near-future dates
    const bookingUrl = cachedSchedulingUrl || process.env.CALENDLY_SCHEDULING_URL || 'https://calendly.com/gavinjoseph2/30min';
    const now = new Date();
    // Find next Mon/Tue/Wed/Thu
    const slots = [];
    const targetDays = [1, 2, 3, 4, 5]; // Mon-Fri
    const businessHours = [10, 12, 14, 16]; // 10am, 12pm, 2pm, 4pm
    let d = new Date(now);
    d.setDate(d.getDate() + 1);
    let hourIdx = 0;
    while (slots.length < 12) { // Get 12 slots across the week
      if (targetDays.includes(d.getDay())) {
        const hours = businessHours[hourIdx % businessHours.length];
        const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, 0, 0).toISOString();
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
        const timeStr = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, 0, 0).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        slots.push({
          time: `${dayName} ${timeStr}`,
          shortTime: `${dayName} ${timeStr}`,
          iso,
          scheduling_url: bookingUrl
        });
        hourIdx++;
      }
      d.setDate(d.getDate() + 1);
    }
    cachedAvailableSlots = slots;
    return {
      available: true,
      topSlots: slots.slice(0, 3).map(s => s.shortTime),
      slots: cachedAvailableSlots.map(s => s.time),
      message: `Great! I have Monday-Friday, 10am-5pm availability. Which time works best for you? Just drop your name and email and I'll lock it in!`
    };
  }

  try {
    const now = new Date();
    const startTime = new Date(now.getTime() + 60000).toISOString();
    const endTime = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString();
    
    const url = `https://api.calendly.com/event_type_available_times?event_type=${encodeURIComponent(cachedEventTypeUri)}&start_time=${startTime}&end_time=${endTime}`;
    console.log('Fetching Calendly slots...');
    const response = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + process.env.CALENDLY_API_KEY }
    });
    const data = await response.json();
    
    if (data.collection && data.collection.length > 0) {
      // Store full slot details for booking
      cachedAvailableSlots = data.collection.map(slot => {
        const date = new Date(slot.start_time);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
        const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
        const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
        return {
          time: `${dayName} ${monthDay} at ${time}`,
          shortTime: `${dayName} ${time}`,
          iso: slot.start_time,
          scheduling_url: slot.scheduling_url
        };
      });
      
      // Group by day for summary
      const slotsByDay = {};
      cachedAvailableSlots.forEach(slot => {
        const date = new Date(slot.iso);
        const dayKey = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
        if (!slotsByDay[dayKey]) slotsByDay[dayKey] = [];
        const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
        slotsByDay[dayKey].push(time);
      });
      
      // Pick just 3-4 best slots (spread across different days)
      const bestSlots = [];
      const usedDays = new Set();
      for (const slot of cachedAvailableSlots) {
        const day = new Date(slot.iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
        if (!usedDays.has(day) && bestSlots.length < 4) {
          bestSlots.push(slot.shortTime);
          usedDays.add(day);
        }
      }
      
      return { 
        available: true, 
        topSlots: bestSlots,
        message: `Great! I have Monday-Friday, 10am-5pm availability. Which time works best for you? Just drop your name and email and I'll lock it in!`
      };
    }
    console.log('Calendly response:', JSON.stringify(data));
    return { available: false, message: 'No available slots found this week.' };
  } catch (error) {
    console.error('Calendly availability error:', error);
    return { error: 'Could not fetch availability' };
  }
}

// Find matching slot from user's preferred time
function findMatchingSlot(preferredTime) {
  if (!cachedAvailableSlots.length) return null;
  
  const searchTerm = preferredTime.toLowerCase();
  
  // Try to match day and time
  for (const slot of cachedAvailableSlots) {
    const slotLower = slot.time.toLowerCase();
    const shortLower = slot.shortTime.toLowerCase();
    
    // Check various matching patterns
    if (slotLower.includes(searchTerm) || shortLower.includes(searchTerm)) {
      return slot;
    }
    
    // Extract day and time parts
    const dayMatch = searchTerm.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
    const timeMatch = searchTerm.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    
    if (dayMatch && slotLower.includes(dayMatch[1].toLowerCase())) {
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const isPM = timeMatch[3]?.toLowerCase() === 'pm';
        const isAM = timeMatch[3]?.toLowerCase() === 'am';
        
        // Convert to 24h for comparison
        if (isPM && hour !== 12) hour += 12;
        if (isAM && hour === 12) hour = 0;
        
        const slotDate = new Date(slot.iso);
        const slotHour = slotDate.getHours();
        
        // Allow 1 hour flexibility
        if (Math.abs(slotHour - hour) <= 1 || (!isAM && !isPM && (slotHour === hour || slotHour === hour + 12))) {
          return slot;
        }
      } else {
        // Just day match, return first slot on that day
        return slot;
      }
    }
  }
  
  return null;
}

async function bookAppointment(name, email, preferredTime, leadSummary, speaksSpanish, diagnosedBefore, foundSolution, motivationScore) {
  const cleanName = name ? name.replace(/\*+/g, '').trim() : '';
  const cleanEmail = email ? email.replace(/\*+/g, '').trim() : '';
  
  // Find matching slot
  const matchedSlot = findMatchingSlot(preferredTime);
  
  if (!matchedSlot) {
    // Get alternative suggestions
    const alternatives = cachedAvailableSlots.slice(0, 4).map(s => s.shortTime);
    return {
      success: false,
      message: `Sorry, ${preferredTime} isn't available. Here are some open slots: ${alternatives.join(', ')}. Which of these works for you?`,
      alternativeSlots: alternatives,
      needsRetry: true
    };
  }
  
  // Build the booking URL with the specific time pre-selected
  const baseUrl = matchedSlot.scheduling_url || cachedSchedulingUrl || process.env.CALENDLY_SCHEDULING_URL || 'https://calendly.com/gavinjoseph2/30min';
  
  // Calendly supports month/date/time params for pre-selection
  const slotDate = new Date(matchedSlot.iso);
  const month = slotDate.toISOString().slice(0, 7); // YYYY-MM
  const date = slotDate.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = slotDate.toISOString().slice(11, 16); // HH:MM
  
  const params = new URLSearchParams();
  if (cleanName) params.set('name', cleanName);
  if (cleanEmail) params.set('email', cleanEmail);
  params.set('month', month);
  params.set('date', date);
  // Note: Calendly will show this date pre-selected
  
  const bookingUrl = `${baseUrl}?${params.toString()}`;
  
  // Send email notification to coach
  console.log('📧 Attempting to send lead notification...', { resendConfigured: !!resend, coachEmail: process.env.COACH_EMAIL });
  if (resend && process.env.COACH_EMAIL) {
    console.log('📧 Sending email via Resend to:', process.env.COACH_EMAIL);
    resend.emails.send({
      from: 'AI Appointment Bot <bot@lead-setter.com>',
      to: process.env.COACH_EMAIL,
      subject: `🎯 New Lead: ${cleanName} booking for ${matchedSlot.shortTime}!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">New Lead Alert! 🎉</h2>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Name:</strong> ${cleanName}</p>
            <p><strong>Email:</strong> ${cleanEmail}</p>
            <p><strong>Requested Time:</strong> ${matchedSlot.time}</p>
          </div>
          <h3 style="color: #1f2937;">Intake Answers:</h3>
          <div style="background: #eff6ff; padding: 20px; border-radius: 8px; border-left: 4px solid #2563eb; margin-bottom: 16px;">
            <p style="margin: 6px 0;"><strong>🌐 Speaks Spanish:</strong> ${speaksSpanish === 'Yes' ? '✅ Yes' : '❌ No'}</p>
            <p style="margin: 6px 0;"><strong>🏥 Previously Diagnosed with Neuropathy:</strong> ${diagnosedBefore === 'Yes' ? '✅ Yes' : '❌ No'}</p>
            <p style="margin: 6px 0;"><strong>💊 Found a Solution:</strong> ${foundSolution === 'Yes' ? '✅ Yes' : '❌ No'}</p>
            <p style="margin: 6px 0;"><strong>🔥 Motivation (1-5):</strong> ${motivationScore || 'N/A'}</p>
          </div>
          <h3 style="color: #1f2937;">Full Summary:</h3>
          <div style="background: #fef3c7; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; white-space: pre-wrap;">${leadSummary || 'No summary provided'}</p>
          </div>
          <p style="color: #6b7280; margin-top: 20px; font-size: 14px;">
            They're completing their booking now. Check your Calendly for the confirmed time.
          </p>
        </div>
      `
    }).then((response) => {
      console.log('📧 Resend response:', JSON.stringify(response));
      if (response.error) {
        console.error('📧 Resend error:', response.error);
      } else {
        console.log('📧 Lead notification sent! ID:', response.data?.id);
      }
    }).catch(emailError => {
      console.error('📧 Email error:', emailError.message || emailError);
    });
  }
  
  return {
    success: true,
    booking_url: bookingUrl,
    matched_time: matchedSlot.time,
    message: `Perfect! I've got you down for ${matchedSlot.time}. Just one quick step - click here to confirm: ${bookingUrl}`
  };
}

// Keep old function for backwards compatibility
async function generateBookingLink(name, email, leadSummary) {
  return bookAppointment(name, email, '', leadSummary);
}

// Tool definitions for Claude
const tools = [
  {
    name: "get_availability",
    description: "Get available appointment slots from Calendly. Call this when the user wants to know what times are available or when starting the booking process.",
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
    name: "book_appointment",
    description: "Book an appointment for the client. Call this when you have their name, email, AND their preferred time. The system will match their preferred time to an available slot and generate a confirmation link.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Client's full name" },
        email: { type: "string", description: "Client's email address" },
        preferredTime: { type: "string", description: "The time the client requested, e.g. 'Tuesday at 2pm' or 'Wednesday afternoon'" },
        leadSummary: { type: "string", description: "Brief summary of the lead: their goal, challenges, and any relevant context from the conversation" },
        speaksSpanish: { type: "string", description: "Does the patient speak Spanish? 'Yes' or 'No'" },
        diagnosedBefore: { type: "string", description: "Has the patient been diagnosed with neuropathy before? 'Yes' or 'No'" },
        foundSolution: { type: "string", description: "Has the patient found a solution to their neuropathy? 'Yes' or 'No'" },
        motivationScore: { type: "string", description: "Patient's motivation score from 1-5 to find a solution" }
      },
      required: ["name", "email", "preferredTime", "leadSummary", "speaksSpanish", "diagnosedBefore", "foundSolution", "motivationScore"]
    }
  }
];

// Handle tool calls
async function handleToolCall(toolName, toolInput) {
  console.log('🔧 Tool called:', toolName, JSON.stringify(toolInput));
  
  if (toolName === 'get_availability') {
    const availability = await getCalendlyAvailability();
    return JSON.stringify(availability);
  }
  
  if (toolName === 'book_appointment') {
    console.log('📋 Booking appointment:', toolInput.preferredTime, 'for', toolInput.name);
    const result = await bookAppointment(
      toolInput.name,
      toolInput.email,
      toolInput.preferredTime,
      toolInput.leadSummary,
      toolInput.speaksSpanish,
      toolInput.diagnosedBefore,
      toolInput.foundSolution,
      toolInput.motivationScore
    );
    return JSON.stringify(result);
  }
  
  // Legacy support
  if (toolName === 'generate_booking_link') {
    const result = await generateBookingLink(toolInput.name, toolInput.email, toolInput.leadSummary);
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

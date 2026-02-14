// AAA Appointment Bot Widget
(function() {
  'use strict';

  // Configuration (override these when embedding)
  const config = window.AAA_CONFIG || {
    apiUrl: 'http://localhost:3456',
    assistantName: 'Alex',
    businessName: 'Our Practice',
    primaryColor: '#2563eb',
    greeting: "Hi there! 👋 I'm here to help you book a free consultation. What brings you here today?"
  };

  // Generate unique session ID
  const sessionId = 'aaa-' + Math.random().toString(36).substr(2, 9);

  // Create widget HTML
  function createWidget() {
    const widget = document.createElement('div');
    widget.id = 'aaa-chat-widget';
    widget.innerHTML = `
      <button id="aaa-chat-toggle" aria-label="Open chat">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
        </svg>
      </button>
      
      <div id="aaa-chat-window">
        <div id="aaa-chat-header">
          <div id="aaa-chat-avatar">🤖</div>
          <div id="aaa-chat-header-text">
            <h3>${config.assistantName}</h3>
            <p>Scheduling Assistant</p>
          </div>
          <button id="aaa-chat-close" aria-label="Close chat">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        
        <div id="aaa-chat-messages"></div>
        
        <div id="aaa-chat-input-area">
          <input type="text" id="aaa-chat-input" placeholder="Type your message..." />
          <button id="aaa-chat-send" aria-label="Send message">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
        
        <div id="aaa-powered">Powered by AI</div>
      </div>
    `;
    document.body.appendChild(widget);

    // Apply custom color
    if (config.primaryColor) {
      widget.style.setProperty('--aaa-primary', config.primaryColor);
    }

    return widget;
  }

  // Load CSS
  function loadStyles() {
    // Check if styles already loaded
    if (document.getElementById('aaa-widget-styles')) return;

    const link = document.createElement('link');
    link.id = 'aaa-widget-styles';
    link.rel = 'stylesheet';
    link.href = config.apiUrl + '/style.css';
    document.head.appendChild(link);
  }

  // Convert URLs in text to clickable links
  function linkify(text) {
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlPattern, (url) => {
      // Clean up any trailing punctuation that's not part of the URL
      let cleanUrl = url.replace(/[.,!?;:]+$/, '');
      let trailing = url.slice(cleanUrl.length);
      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${trailing}`;
    });
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Add message to chat
  function addMessage(text, isUser = false) {
    const messages = document.getElementById('aaa-chat-messages');
    const msg = document.createElement('div');
    msg.className = 'aaa-message ' + (isUser ? 'user' : 'bot');
    
    if (isUser) {
      // User messages: plain text only (no links)
      msg.textContent = text;
    } else {
      // Bot messages: escape HTML first, then convert URLs to links
      msg.innerHTML = linkify(escapeHtml(text));
    }
    
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
  }

  // Show typing indicator
  function showTyping() {
    const messages = document.getElementById('aaa-chat-messages');
    const typing = document.createElement('div');
    typing.id = 'aaa-typing';
    typing.className = 'aaa-message bot aaa-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
  }

  // Hide typing indicator
  function hideTyping() {
    const typing = document.getElementById('aaa-typing');
    if (typing) typing.remove();
  }

  // Send message to API
  async function sendMessage(message) {
    const sendBtn = document.getElementById('aaa-chat-send');
    const input = document.getElementById('aaa-chat-input');
    
    sendBtn.disabled = true;
    input.disabled = true;
    showTyping();

    try {
      const response = await fetch(config.apiUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message })
      });

      const data = await response.json();
      hideTyping();
      
      if (data.response) {
        addMessage(data.response, false);
      } else if (data.error) {
        addMessage("Sorry, something went wrong. Please try again.", false);
      }
    } catch (error) {
      hideTyping();
      addMessage("Sorry, I couldn't connect. Please check your internet and try again.", false);
      console.error('AAA Chat Error:', error);
    }

    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }

  // Initialize widget
  function init() {
    loadStyles();
    const widget = createWidget();

    const toggle = document.getElementById('aaa-chat-toggle');
    const chatWindow = document.getElementById('aaa-chat-window');
    const closeBtn = document.getElementById('aaa-chat-close');
    const input = document.getElementById('aaa-chat-input');
    const sendBtn = document.getElementById('aaa-chat-send');

    let isFirstOpen = true;

    // Toggle chat
    toggle.addEventListener('click', () => {
      chatWindow.classList.add('open');
      toggle.style.display = 'none';
      input.focus();

      // Show greeting on first open
      if (isFirstOpen) {
        isFirstOpen = false;
        setTimeout(() => {
          addMessage(config.greeting, false);
        }, 500);
      }
    });

    // Close chat
    closeBtn.addEventListener('click', () => {
      chatWindow.classList.remove('open');
      toggle.style.display = 'flex';
    });

    // Send on button click
    sendBtn.addEventListener('click', () => {
      const message = input.value.trim();
      if (message) {
        addMessage(message, true);
        input.value = '';
        sendMessage(message);
      }
    });

    // Send on Enter
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const message = input.value.trim();
        if (message) {
          addMessage(message, true);
          input.value = '';
          sendMessage(message);
        }
      }
    });
  }

  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

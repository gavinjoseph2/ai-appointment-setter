module.exports = {
  apps: [{
    name: 'aaa-bot',
    script: 'server.js',
    cwd: 'C:/Users/gavin/clawd/aaa-bot',
    env: {
      ANTHROPIC_API_KEY: 'your_anthropic_api_key_here',
      CALCOM_API_KEY: 'your_calcom_api_key_here',
      CALCOM_EVENT_TYPE_ID: 'your_event_type_id_here',
      PORT: '3456',
      BUSINESS_NAME: 'Coach Smith',
      ASSISTANT_NAME: 'Alex'
    }
  }]
};
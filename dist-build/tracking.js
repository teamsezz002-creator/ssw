(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const userId = urlParams.get('userId');
  const simId = urlParams.get('simId');
  
  // Use a stable sessionId for the duration of the page load
  let sessionId = sessionStorage.getItem('sim_session_id');
  if (!sessionId) {
    sessionId = 'sess-' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('sim_session_id', sessionId);
  }

  const startTime = Date.now();

  console.log('[Tracking SDK] Initialized', { userId, simId, sessionId });

  const trackEvent = async (type, data = {}) => {
    const event = {
      userId,
      simId,
      sessionId,
      type,
      data,
      timestamp: new Date().toISOString()
    };

    console.log('[Tracking SDK] Sending Event:', type, event);

    try {
      // Use navigator.sendBeacon for better reliability on page unload
      const blob = new Blob([JSON.stringify(event)], { type: 'application/json' });
      const success = navigator.sendBeacon('/api/track', blob);
      
      if (!success) {
        // Fallback to fetch if sendBeacon fails or is not available
        await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          keepalive: true
        });
      }
    } catch (e) {
      console.warn('[Tracking SDK] Failed to send event', e);
    }
  };

  // Expose to window for simulation to call
  window.SimulationTracking = {
    track: trackEvent,
    trackQuestionAttempt: (questionId, selectedAnswer, isCorrect, attemptNumber) => {
      trackEvent('QUESTION_ATTEMPT', { questionId, selectedAnswer, isCorrect, attemptNumber });
      if (isCorrect) {
        trackEvent('QUESTION_CORRECT', { questionId });
      }
    },
    trackStepComplete: (stepId) => {
      trackEvent('STEP_COMPLETE', { stepId });
    },
    trackSimulationComplete: (results) => {
      trackEvent('SIMULATION_COMPLETE', results);
    }
  };

  // Lifecycle events
  window.addEventListener('load', () => {
    trackEvent('SIMULATION_START', { url: window.location.href });
  });

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const duration = (Date.now() - startTime) / 1000;
      trackEvent('SIMULATION_HEARTBEAT', { duration });
    }
  });

})();

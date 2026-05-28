export function notifyCopilotResponseReady(): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;

  const title = 'Copilot';
  const body = 'Your response is ready in the LLM tab.';

  if (Notification.permission === 'granted') {
    new Notification(title, { body });
    return;
  }

  if (Notification.permission !== 'denied') {
    void Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    });
  }
}

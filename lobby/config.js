window.WORKER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:8787'
  : '';  // same origin in production (worker serves API + Pages in same domain via routes)

window.WORKER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:8787'
  : window.location.origin;

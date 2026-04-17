export { GameRoom } from './room.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsResponse(body, init = {}) {
  const { status = 200, headers = {} } = init;
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // POST /api/rooms — create a new room
    if (method === 'POST' && url.pathname === '/api/rooms') {
      // Auto-increment counter starting at 1000
      let counter = parseInt(await env.KV.get('room_counter') || '999', 10);
      counter += 1;
      await env.KV.put('room_counter', String(counter));

      // Pad to at least 4 digits
      const code = String(counter).padStart(4, '0');

      // Instantiate the Durable Object for this room
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);

      // Prime the room with its code
      await stub.fetch(new Request(`${url.origin}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }));

      return corsResponse(JSON.stringify({ code }));
    }

    // GET /api/rooms/:code — WebSocket upgrade to GameRoom DO
    const roomMatch = url.pathname.match(/^\/api\/rooms\/(\d+)$/);
    if (method === 'GET' && roomMatch) {
      const code = roomMatch[1];
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);
      // Forward the request (including Upgrade header) to the DO
      return stub.fetch(request);
    }

    return corsResponse(JSON.stringify({ error: 'Not Found' }), { status: 404 });
  },
};

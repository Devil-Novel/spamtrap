const crypto = require('crypto');
const cookieSession = require('cookie-session');

// Only an opaque random ID is sent to the browser. OAuth tokens stay in RAM.
// Deliberately single-instance: a restart invalidates sessions, never guild data.
function serverSessions({ secret, secure, now = Date.now, maxAge = 7 * 86400000, maxSessions = 10000 }) {
  const records = new Map();
  const transport = cookieSession({ name: 'spamtrap', keys: [secret], secure, sameSite: 'lax', httpOnly: true, maxAge });
  const sweep = () => { for (const [id, record] of records) if (record.expires <= now()) records.delete(id); };
  const timer = setInterval(sweep, 60000);
  timer.unref();
  const middleware = (req, res, next) => transport(req, res, () => {
    const cookieDescriptor = Object.getOwnPropertyDescriptor(req, 'session');
    let id = req.session.sid;
    let record = typeof id === 'string' ? records.get(id) : null;
    if (record && (record.expires <= now() || (record.data.tokenExpiresAt && record.data.tokenExpiresAt <= now()))) {
      records.delete(id);
      record = null;
    }
    // Replace legacy token-bearing cookies, invalid sessions and replayed IDs.
    cookieDescriptor.set.call(req, record ? { sid: id } : {});
    const ensure = () => {
      if (!record) {
        sweep();
        if (records.size >= maxSessions) throw Object.assign(new Error('Session capacity reached; try again later'), { status: 503 });
        id = crypto.randomBytes(32).toString('hex');
        record = { data: {}, expires: now() + maxAge };
        records.set(id, record);
        cookieDescriptor.set.call(req, { sid: id });
      }
      return record.data;
    };
    const proxy = new Proxy({}, {
      get: (_, key) => record?.data[key],
      set: (_, key, value) => { ensure()[key] = value; return true; },
      deleteProperty: (_, key) => { if (record) delete record.data[key]; return true; },
    });
    Object.defineProperty(req, 'session', {
      configurable: true,
      get: () => proxy,
      set: (value) => {
        if (id) records.delete(id);
        record = null;
        cookieDescriptor.set.call(req, null);
        if (value) Object.assign(ensure(), value);
      },
    });
    req.rotateSession = () => {
      const data = { ...(record?.data || {}) };
      req.session = data;
    };
    next();
  });
  middleware.close = () => { clearInterval(timer); records.clear(); };
  return middleware;
}
module.exports = { serverSessions };

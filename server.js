// Đặt Món Chung — group food ordering from a ShopeeFood link.
// No dependencies: needs Node.js 18 or newer. Run with `node server.js`.
//
//   PORT        port to listen on (default 3000)
//   DATA_DIR    folder for data.json (default ./data)
//   GAPP_BASE   ShopeeFood API base (default https://gappapi.deliverynow.vn/api/)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const GAPP_BASE = process.env.GAPP_BASE || 'https://gappapi.deliverynow.vn/api/';
const PUBLIC_DIR = path.join(__dirname, 'public');
const KEEP_DAYS = 14;

// ---------- storage ----------
let db = { shops: {}, orders: [] };
// True when the server starts with no saved data (e.g. a free host wiped its disk).
// Browsers that remember menus then send them back, see restoreShops() in index.html.
const freshBoot = !fs.existsSync(DATA_FILE);
try { db = { shops: {}, orders: [], ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch (e) { /* first run */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    db.orders = db.orders.filter((o) => o.at > cutoff);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  }, 200);
}

// ---------- live updates (Server-Sent Events) ----------
// Menus are big and change rarely, orders are small and change often, so they go out as separate events.
const clients = new Set();
const shopList = () => Object.values(db.shops).sort((a, b) => a.addedAt - b.addedAt);
const shopsMsg = () => 'event: shops\ndata: ' + JSON.stringify({ shops: shopList(), freshBoot: freshBoot && !shopList().length }) + '\n\n';
const ordersMsg = () => 'event: orders\ndata: ' + JSON.stringify({ orders: db.orders }) + '\n\n';
function broadcast(msg) { for (const res of clients) res.write(msg); }
function shopsChanged() { save(); broadcast(shopsMsg()); broadcast(ordersMsg()); }
function ordersChanged() { save(); broadcast(ordersMsg()); }
setInterval(() => broadcast(': ping\n\n'), 25000);

// ---------- ShopeeFood ----------
const FOODY_HEADERS = {
  'x-foody-client-id': '', 'x-foody-client-type': '1', 'x-foody-app-type': '1004', 'x-foody-client-version': '3.0.0',
  'x-foody-api-version': '1', 'x-foody-client-language': 'vi', 'x-foody-access-token': '',
  'accept': 'application/json, text/plain, */*', 'origin': 'https://shopeefood.vn', 'referer': 'https://shopeefood.vn/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};
async function gapp(p) {
  try {
    const r = await fetch(GAPP_BASE + p, { headers: FOODY_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { console.warn('ShopeeFood', r.status, p); return null; }
    const j = await r.json();
    return (j && j.reply) || null;
  } catch (e) { console.warn('ShopeeFood', e.message, p); return null; }
}

// Returns {id, slug} from a shopeefood.vn link, following share/short links when needed.
async function parseLink(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (!/(^|\.)(shopeefood\.vn|now\.vn|foody\.vn|shopee\.vn|shp\.ee)$/.test(u.hostname)) return null;
  const fromUrl = (x) => {
    if (!/(^|\.)(shopeefood\.vn|now\.vn)$/.test(x.hostname)) return null;
    const m = x.pathname.match(/\/shop\/(\d+)/);
    if (m) return { id: m[1], slug: '' };
    const slug = x.pathname.replace(/^\/+|\/+$/g, '');
    return slug && slug.includes('/') ? { id: '', slug } : null;
  };
  const direct = fromUrl(u);
  if (direct) return direct;
  try { // short link: follow redirects and look at where it lands
    const r = await fetch(u, { redirect: 'follow', headers: { 'user-agent': FOODY_HEADERS['user-agent'] }, signal: AbortSignal.timeout(10000) });
    return fromUrl(new URL(r.url));
  } catch (e) { return null; }
}

const priceOf = (p) => (p && typeof p.value === 'number') ? p.value : (p ? Number(String(p.text || '').replace(/\D/g, '')) || 0 : 0);
const str = (x, n) => String(x == null ? '' : x).slice(0, n);
// ShopeeFood lists each photo in several sizes; take the smallest one that is still sharp in a 72px box.
function photoOf(photos) {
  const list = (Array.isArray(photos) ? photos : []).filter((p) => p && p.value).sort((a, b) => (a.width || 0) - (b.width || 0));
  const p = list.find((x) => (x.width || 0) >= 120) || list[list.length - 1];
  return p ? p.value : '';
}

async function fetchShop({ id, slug }) {
  let det = null, did = null, rid = id || null;
  if (slug) { const r = await gapp('delivery/get_from_url?url=' + encodeURIComponent(slug)); if (r) { did = r.delivery_id || null; rid = r.restaurant_id || rid; } }
  if (rid && !did) { const r = await gapp('delivery/get_detail?id_type=1&request_id=' + rid); det = r && r.delivery_detail; if (det) did = det.delivery_id; }
  if (id && !det && !did) { const r = await gapp('delivery/get_detail?id_type=2&request_id=' + id); det = r && r.delivery_detail; if (det) { did = id; rid = det.restaurant_id; } }
  if (did && !det) { const r = await gapp('delivery/get_detail?id_type=2&request_id=' + did); det = r && r.delivery_detail; }
  let menu = did ? await gapp('dish/get_delivery_dishes?id_type=2&request_id=' + did) : null;
  if (!(menu && menu.menu_infos && menu.menu_infos.length) && rid) menu = await gapp('dish/get_delivery_dishes?id_type=1&request_id=' + rid);
  const infos = (menu && menu.menu_infos) || [];
  if (!infos.length) return null;
  return normalizeMenu({
    id: String(rid || did || id || ''), name: det && det.name, address: det && det.address, photo: det && photoOf(det.photos),
    categories: infos.map((c) => ({
      name: c.dish_type_name,
      dishes: (c.dishs || []).map((d) => ({
        id: d.id, name: d.name, desc: d.description, photo: photoOf(d.photos),
        price: priceOf(d.discount_price) || priceOf(d.price), oldPrice: d.discount_price ? priceOf(d.price) : 0, available: d.is_available !== false,
        options: (d.options || []).map((o) => ({
          name: o.name, min: o.option_items && o.option_items.min_select, max: o.option_items && o.option_items.max_select,
          items: ((o.option_items && o.option_items.items) || []).map((i) => ({ name: i.name, price: priceOf(i.price) })),
        })),
      })),
    })),
  });
}

// Also used for menus pasted by hand (from the console snippet) and menus browsers send back after a wipe.
function normalizeMenu(m) {
  const num = (x) => { const n = Number(x); return isFinite(n) && n > 0 ? Math.round(n) : 0; };
  const img = (x) => /^https:\/\/[^\s"'<>]+$/.test(String(x || '')) ? str(x, 400) : '';
  const categories = (Array.isArray(m.categories) ? m.categories : []).slice(0, 80).map((c, ci) => ({
    name: str(c.name, 80) || 'Món',
    dishes: (Array.isArray(c.dishes) ? c.dishes : []).slice(0, 300).map((d, di) => ({
      id: str(d.id, 40) || ('d' + ci + '-' + di), name: str(d.name, 120), desc: str(d.desc, 200), photo: img(d.photo),
      price: num(d.price), oldPrice: num(d.oldPrice) > num(d.price) ? num(d.oldPrice) : 0, available: d.available !== false,
      options: (Array.isArray(d.options) ? d.options : []).slice(0, 12).map((o) => ({
        name: str(o.name, 60), min: num(o.min), max: num(o.max),
        items: (Array.isArray(o.items) ? o.items : []).slice(0, 40).map((i) => ({ name: str(i.name, 60), price: num(i.price) })),
      })).filter((o) => o.items.length),
    })).filter((d) => d.name),
  })).filter((c) => c.dishes.length);
  if (!categories.length) return null;
  return { sourceId: str(m.id, 40), name: str(m.name, 120) || 'Quán mới', address: str(m.address, 200), photo: img(m.photo), categories };
}

function storeShop(menu, url) {
  const key = menu.sourceId ? 'sf-' + menu.sourceId.replace(/[^A-Za-z0-9_-]/g, '') : 'shop-' + crypto.randomBytes(4).toString('hex');
  const prev = db.shops[key];
  db.shops[key] = { key, ...menu, url: str(url, 300) || (prev && prev.url) || '', addedAt: prev ? prev.addedAt : Date.now(), updatedAt: Date.now() };
  shopsChanged();
  return db.shops[key];
}

// ---------- orders ----------
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
function findDish(shopId, dishId) {
  const shop = db.shops[shopId];
  const dish = shop && shop.categories.flatMap((c) => c.dishes).find((d) => d.id === String(dishId));
  return dish ? { shop, dish } : null;
}
// Turns the option indexes a browser sent into names and an extra price, computed from the stored menu.
function pickOptions(dish, sel) {
  sel = Array.isArray(sel) ? sel : [];
  const picked = dish.options.map((o, gi) => {
    const idx = [...new Set((Array.isArray(sel[gi]) ? sel[gi] : []).map(Number))].filter((i) => o.items[i]);
    return { o, items: (o.max ? idx.slice(0, o.max) : idx).map((i) => o.items[i]) };
  });
  const missing = picked.find((g) => g.o.min && g.items.length < g.o.min);
  if (missing) return { error: 'Hãy chọn “' + missing.o.name + '”.' };
  return {
    extra: picked.reduce((s, g) => s + g.items.reduce((a, i) => a + i.price, 0), 0),
    opts: picked.filter((g) => g.items.length).map((g) => g.items.map((i) => i.name).join(', ')).join(' · '),
  };
}

// ---------- HTTP ----------
function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 3e6) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { ok: true });

    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 2000\n\n' + shopsMsg() + ordersMsg());
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/shops') {
      const body = await readBody(req);
      if (body.menu) { // menu pasted by hand, or sent back by a browser after a wipe
        const menu = body.menu && body.menu.kind === 'dat-mon-chung/menu' ? normalizeMenu(body.menu) : null;
        if (!menu) return send(res, 400, { error: 'Nội dung dán vào không phải menu hợp lệ.' });
        return send(res, 200, { shop: storeShop(menu, body.menu.url || body.url) });
      }
      const link = await parseLink(body.url);
      if (!link) return send(res, 400, { error: 'Link chưa đúng. Hãy dán link quán trên shopeefood.vn, ví dụ https://shopeefood.vn/ho-chi-minh/ten-quan' });
      const menu = await fetchShop(link);
      if (!menu) return send(res, 502, { error: 'Máy chủ chưa lấy được menu từ ShopeeFood. Dùng cách dự phòng bên dưới (mất khoảng 1 phút).', fallback: link });
      return send(res, 200, { shop: storeShop(menu, body.url) });
    }

    let m;
    if (req.method === 'POST' && (m = pathname.match(/^\/api\/shops\/([\w-]+)\/refresh$/))) {
      const shop = db.shops[m[1]];
      if (!shop) return send(res, 404, { error: 'Không thấy quán.' });
      const link = (shop.sourceId && { id: shop.sourceId, slug: '' }) || await parseLink(shop.url);
      const menu = link && await fetchShop(link);
      if (!menu) return send(res, 502, { error: 'Không lấy lại được menu lúc này.' });
      return send(res, 200, { shop: storeShop(menu, shop.url) });
    }
    if (req.method === 'DELETE' && (m = pathname.match(/^\/api\/shops\/([\w-]+)$/))) {
      if (!db.shops[m[1]]) return send(res, 404, { error: 'Không thấy quán.' });
      delete db.shops[m[1]];
      db.orders = db.orders.filter((o) => o.shopId !== m[1]);
      shopsChanged();
      return send(res, 200, { ok: true });
    }

    // Adds `delta` (+1 / -1 / any) to this person's line for a dish with these options, made today.
    // Creating, growing, shrinking and removing a line all go through here, so taps on +/− are instant for everyone.
    if (req.method === 'POST' && pathname === '/api/orders/adjust') {
      const b = await readBody(req);
      const found = findDish(b.shopId, b.dishId);
      if (!found) return send(res, 400, { error: 'Món này không còn trong menu.' });
      const { shop, dish } = found;
      const who = str(b.who, 40).trim();
      const owner = str(b.clientId, 40);
      if (!who || !owner) return send(res, 400, { error: 'Nhập tên bạn trước khi chọn món.' });
      const delta = Math.max(-50, Math.min(50, Math.round(Number(b.delta) || 0)));
      if (!delta) return send(res, 400, { error: 'Số lượng không hợp lệ.' });
      const note = str(b.note, 120).trim();
      let line = b.orderId ? db.orders.find((o) => o.id === String(b.orderId)) : null;
      if (line && line.owner !== owner) return send(res, 403, { error: 'Chỉ người đặt mới sửa được món này.' });
      if (!line) {
        const p = pickOptions(dish, b.options);
        if (p.error) return send(res, 400, p);
        line = db.orders.find((o) => o.owner === owner && o.shopId === shop.key && o.dishId === dish.id && o.opts === p.opts && o.note === note && o.day === today());
        if (!line) {
          if (delta < 0) return send(res, 200, { ok: true });
          if (!dish.available) return send(res, 400, { error: 'Quán đang tạm hết món này.' });
          line = { id: crypto.randomBytes(6).toString('hex'), shopId: shop.key, dishId: dish.id, dish: dish.name, price: dish.price + p.extra, qty: 0, opts: p.opts, note, who, owner, at: Date.now(), day: today() };
          db.orders.push(line);
        }
      }
      line.qty = Math.min(99, line.qty + delta);
      line.who = who;
      if (line.qty <= 0) db.orders = db.orders.filter((o) => o !== line);
      ordersChanged();
      return send(res, 200, { order: line.qty > 0 ? line : null });
    }
    // Renaming yourself renames your lines for today, so the board never shows an old name.
    if (req.method === 'POST' && pathname === '/api/rename') {
      const b = await readBody(req);
      const who = str(b.who, 40).trim(), owner = str(b.clientId, 40);
      if (!who || !owner) return send(res, 400, { error: 'Tên trống.' });
      let n = 0;
      for (const o of db.orders) if (o.owner === owner && o.day === today() && o.who !== who) { o.who = who; n++; }
      if (n) ordersChanged();
      return send(res, 200, { renamed: n });
    }
    if (req.method === 'POST' && pathname === '/api/orders/clear') {
      const b = await readBody(req);
      const ids = new Set(Array.isArray(b.ids) ? b.ids.map(String) : []);
      const before = db.orders.length;
      db.orders = db.orders.filter((o) => !ids.has(o.id));
      ordersChanged();
      return send(res, 200, { removed: before - db.orders.length });
    }

    if (req.method === 'GET' && !pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
    send(res, 404, { error: 'Không tìm thấy.' });
  } catch (e) {
    send(res, 400, { error: 'Yêu cầu không hợp lệ.' });
  }
});

server.listen(PORT, () => console.log('Đặt Món Chung đang chạy ở http://localhost:' + PORT));

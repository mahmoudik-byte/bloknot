// Блокнот · виджет «Срочное» для приложения Scriptable (iPhone).
// Показывает дела из Блокнота: срочные (отметка «Срочно» или срок сегодня/прошёл) — из «Дел» и отдельно из «Работы»,
// и, если нужно, остальные дела. Нажатие на виджет — сразу диктовка: сказал, и дело записалось в Блокнот.
// Данные — тот же файл, что синхронизирует Блокнот: github.com/mahmoudik-byte/dela → data/bloknot.json.
// Ключ GitHub хранится только в «Связке ключей» телефона (Keychain), в скрипте его нет.
// Параметр виджета (долгое нажатие → «Изменить виджет» → Parameter): пусто или «все» — срочные + остальные; «срочные» — только срочные.

const REPO = 'mahmoudik-byte/dela', FILE = 'data/bloknot.json', KEY = 'bloknot-github-token';
const C = {
  bg: Color.dynamic(new Color('#eef0f4'), new Color('#15171c')),
  card: Color.dynamic(new Color('#ffffff'), new Color('#22252c')),
  text: Color.dynamic(new Color('#2f3237'), new Color('#eef0f4')),
  muted: Color.dynamic(new Color('#8a9099'), new Color('#9aa1ab')),
  red: new Color('#e03131'), blue: new Color('#1c7ed6'), navy: new Color('#3b5bdb'),
};
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');

async function getToken(ask) {
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  if (!ask) return null;
  const a = new Alert();
  a.title = 'Ключ GitHub';
  a.message = 'Вставь ключ доступа к репозиторию «dela» — тот же, что вставлял в Блокноте (облачко ☁️). Он сохранится только в этом телефоне.';
  a.addSecureTextField('github_pat_… или ghp_…');
  a.addAction('Сохранить'); a.addCancelAction('Отмена');
  if (await a.present() === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEY, t);
  return t || null;
}

async function gh(token, method, body) {
  const r = new Request(`https://api.github.com/repos/${REPO}/contents/${FILE}`);
  r.method = method;
  r.headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  if (body) r.body = JSON.stringify(body);
  const j = await r.loadJSON();
  return { status: r.response.statusCode, j };
}
async function load(token) {
  const { status, j } = await gh(token, 'GET');
  if (status !== 200 || !j.content) throw new Error(status === 401 ? 'ключ не подходит' : (j.message || 'нет доступа') + ' (' + status + ')');
  const data = JSON.parse(Data.fromBase64String(j.content.replace(/\n/g, '')).toRawString());
  return { sha: j.sha, data };
}
// поменять файл: change(data) правит данные; если файл успели поменять (Блокнот синхронизировался) — заходим заново
async function update(token, change, message) {
  for (let i = 0; i < 3; i++) {
    const { sha, data } = await load(token);
    const res = change(data); if (res === false) return false;
    data.updatedAt = Date.now();
    const content = Data.fromString(JSON.stringify(data, null, 1) + '\n').toBase64String();
    const { status, j } = await gh(token, 'PUT', { message, content, sha });
    if (status === 200 || status === 201) return true;
    if (status !== 409 && status !== 422) throw new Error(j.message || ('ошибка ' + status));
  }
  throw new Error('файл всё время меняется — попробуй ещё раз');
}

const findList = (data, name) => data.lists.find(l => norm(l.name) === norm(name));
function pick(data, mode) {
  const eod = new Date(); eod.setHours(23, 59, 59, 999);
  const urgent = n => !n.done && (n.urgent || (n.remindAt && n.remindAt <= +eod));
  const sort = (a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || (a.remindAt || 9e15) - (b.remindAt || 9e15) || b.createdAt - a.createdAt;
  const dela = findList(data, 'Дела'), work = findList(data, 'Работа');
  const of = l => l ? data.notes.filter(n => n.listId === l.id && !n.done) : [];
  const groups = [
    { title: 'Срочно', color: C.red, items: of(dela).filter(urgent).sort(sort) },
    { title: 'Работа', color: C.navy, items: of(work).filter(urgent).sort(sort) },
  ];
  if (mode !== 'срочные') groups.push({ title: 'Остальные дела', color: C.muted, items: of(dela).filter(n => !urgent(n)).sort(sort) });
  return groups.filter(g => g.items.length);
}

function row(w, n, color, urlBase) {
  const r = w.addStack(); r.layoutHorizontally(); r.centerAlignContent(); r.spacing = 6;
  r.url = urlBase + '?done=' + encodeURIComponent(n.id);
  const sym = SFSymbol.named(n.urgent ? 'bolt.fill' : 'circle'); sym.applyFont(Font.systemFont(12));
  const im = r.addImage(sym.image); im.imageSize = new Size(13, 13); im.tintColor = n.urgent ? C.red : color;
  const t = r.addText(n.title || n.text || '—'); t.font = Font.systemFont(14); t.textColor = C.text; t.lineLimit = 1;
  r.addSpacer();
  if (n.remindAt) {
    const late = n.remindAt < Date.now(), d = new Date(n.remindAt);
    const tm = r.addText(late ? 'просрочено' : pad(d.getHours()) + ':' + pad(d.getMinutes()));
    tm.font = Font.semiboldSystemFont(11); tm.textColor = late ? C.red : C.muted;
  }
}

async function buildWidget(token, mode) {
  const w = new ListWidget(); w.backgroundColor = C.bg; w.setPadding(14, 16, 12, 16);
  const urlBase = URLScheme.forRunningScript();
  w.url = urlBase + '?say=1';
  const head = w.addStack(); head.layoutHorizontally(); head.centerAlignContent();
  const hs = SFSymbol.named('bolt.fill'); const hi = head.addImage(hs.image); hi.imageSize = new Size(16, 16); hi.tintColor = C.red;
  head.addSpacer(5);
  const ht = head.addText('Срочное'); ht.font = Font.heavySystemFont(17); ht.textColor = C.text;
  head.addSpacer();
  const say = head.addStack(); say.url = urlBase + '?say=1'; say.backgroundColor = new Color('#e03131', 0.14); say.cornerRadius = 11; say.setPadding(4, 9, 4, 9);
  const st = say.addText('🎙 Сказать'); st.font = Font.boldSystemFont(12); st.textColor = C.red;
  w.addSpacer(8);
  if (!token) { const t = w.addText('Открой этот скрипт в Scriptable и вставь ключ GitHub'); t.font = Font.systemFont(13); t.textColor = C.muted; return w; }
  let groups;
  try { groups = pick((await load(token)).data, mode); }
  catch (e) { const t = w.addText('Не загрузилось: ' + e.message); t.font = Font.systemFont(13); t.textColor = C.red; return w; }
  const fam = config.widgetFamily || 'large';
  let budget = fam === 'large' || fam === 'extraLarge' ? 11 : fam === 'medium' ? 4 : 3;
  if (!groups.length) { const t = w.addText('Ничего горящего 👌 Нажми и скажи новое дело'); t.font = Font.systemFont(14); t.textColor = C.muted; }
  for (const g of groups) {
    if (budget <= 0) break;
    const gt = w.addText(g.title.toUpperCase() + ' · ' + g.items.length); gt.font = Font.heavySystemFont(10); gt.textColor = g.color;
    w.addSpacer(3); budget--;
    for (const n of g.items) { if (budget <= 0) break; row(w, n, g.color, urlBase); w.addSpacer(4); budget--; }
    w.addSpacer(4);
  }
  w.addSpacer();
  const d = new Date(), f = w.addText('обновлено ' + pad(d.getHours()) + ':' + pad(d.getMinutes())); f.font = Font.systemFont(9); f.textColor = C.muted;
  w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
  return w;
}

// «срочно …» и «по работе …» в начале фразы
function parseSpeech(raw) {
  let text = String(raw || '').trim(), urgent = false, work = false;
  for (let i = 0; i < 2; i++) {
    let m = text.match(/^(срочн(о|ое|ая|ый)?|важно)[\s,.:!—-]*(.*)$/i); if (m && m[3]) { urgent = true; text = m[3].trim(); }
    m = text.match(/^(по работе|работа)[\s,.:!—-]+(.*)$/i); if (m && m[2]) { work = true; text = m[2].trim(); }
  }
  return { text: text.charAt(0).toUpperCase() + text.slice(1), urgent, work };
}

async function say(token) {
  while (true) {
    let raw;
    try { raw = await Dictation.start('ru-RU'); } catch (e) { return; }
    if (!raw || !raw.trim()) return;
    const p = parseSpeech(raw);
    const a = new Alert();
    a.title = (p.urgent ? '⚡ Срочно · ' : '') + (p.work ? 'Работа' : 'Дела');
    a.message = p.text;
    a.addAction('Записать'); a.addAction('Записать срочно'); a.addAction(p.work ? 'Записать в Дела' : 'Записать в Работу');
    a.addCancelAction('Отмена');
    const ch = await a.present();
    if (ch === -1) return;
    if (ch === 1) p.urgent = true;
    if (ch === 2) p.work = !p.work;
    try {
      await update(token, data => {
        const l = findList(data, p.work ? 'Работа' : 'Дела') || findList(data, 'Дела');
        if (!l) throw new Error('нет списка «Дела»');
        const now = Date.now();
        data.notes.push({ id: uid(), listId: l.id, title: p.text, text: '', category: '', done: false, urgent: p.urgent, photos: [], createdAt: now, updatedAt: now, remindAt: null });
      }, 'Дела: из виджета');
    } catch (e) { const er = new Alert(); er.title = 'Не записалось'; er.message = e.message; er.addAction('Ок'); await er.present(); return; }
    const ok = new Alert(); ok.title = 'Записал ✓'; ok.message = (p.work ? 'Работа' : 'Дела') + (p.urgent ? ' · срочно' : '') + '\n' + p.text;
    ok.addAction('Ещё одно'); ok.addCancelAction('Готово');
    if (await ok.present() === -1) return;
  }
}

async function markDone(token, id) {
  const { data } = await load(token);
  const n = data.notes.find(x => x.id === id); if (!n) return;
  const a = new Alert(); a.title = 'Выполнено?'; a.message = n.title || n.text; a.addAction('Да, сделано'); a.addCancelAction('Нет');
  if (await a.present() === -1) return;
  await update(token, d => { const x = d.notes.find(y => y.id === id); if (!x) return false; x.done = true; x.updatedAt = Date.now(); }, 'Дела: выполнено из виджета');
}

const q = args.queryParameters || {};
const mode = norm(args.widgetParameter);
if (config.runsInWidget) {
  Script.setWidget(await buildWidget(await getToken(false), mode));
} else {
  const token = await getToken(true);
  if (token) {
    if (q.say) await say(token);
    else if (q.done) await markDone(token, q.done);
    else (await buildWidget(token, mode)).presentLarge();
  }
}
Script.complete();

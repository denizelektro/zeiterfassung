/**
 * Zeiterfassung – Baudienstleistungen D. Söner
 * Google Apps Script (an die Google-Tabelle "Zeiterfassung Datenbank" gebunden)
 *
 * Einrichtung: einmal die Funktion  einrichten  ausführen, dann als Web-App bereitstellen
 * (Ausführen als: Ich · Zugriff: Jeder).
 */

var APP = {
  appUrl: 'https://denizelektro.github.io/zeiterfassung/',
  ordner: 'Zeiterfassung',          // Ordner in "Meine Ablage" für Monatsberichte
  logoName: 'LOGO_NEU_07.07.26-removebg-preview.png',
  firma: 'Baudienstleistungen D. Söner',
  tokenTage: 365,                    // so lange bleibt ein Handy angemeldet
  zeitzone: 'Europe/Berlin',
  // Meine Ablage › Gewerbe › Gewerbe D.Söner › Rechn.-Angebot  (darin Jahres-Ordner)
  rechnungsOrdnerId: '1ozfjn9T2Ofchk7JaRp0C2CV2Z97X4tic'
};

var T = {
  MA:  { name: 'Mitarbeiter', kopf: ['id', 'name', 'pinHash', 'rolle', 'sprache', 'aktiv', 'urlaubJahr', 'urlaubStartJahr', 'urlaubStartGenommen', 'ntfy'] },
  ME:  { name: 'Nachrichten', kopf: ['id', 'von', 'an', 'zeit', 'baustelle', 'art', 'text', 'gelesen'] },
  BS:  { name: 'Baustellen',  kopf: ['id', 'name', 'adresse', 'aktiv', 'erstellt'] },
  E:   { name: 'Eintraege',   kopf: ['id', 'ma', 'datum', 'typ', 'baustelle', 'start', 'ende', 'pause', 'pauseStart', 'taetigkeit', 'material', 'km', 'geaendert', 'belege'] },
  TAG: { name: 'Abschluesse', kopf: ['ma', 'datum', 'zeit'] },
  SP:  { name: 'Monatssperren', kopf: ['ma', 'monat', 'zeit', 'tabelleId', 'pdfId'] }
};

/* ============================ Web-App ============================ */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Zeiterfassung')
    .addMetaTag('viewport', 'width=device-width, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Schnittstelle für die installierbare App (GitHub Pages): POST mit {token, aktion, daten}. */
function doPost(e) {
  var antwort;
  try {
    var b = JSON.parse(e.postData.contents);
    antwort = api(b.token, b.aktion, b.daten);
  } catch (x) {
    antwort = { ok: false, fehler: String(x && x.message || x) };
  }
  return ContentService.createTextOutput(JSON.stringify(antwort)).setMimeType(ContentService.MimeType.JSON);
}

/** Einziger Einstiegspunkt für die App. */
function api(token, aktion, daten) {
  try {
    daten = daten || {};
    _C = {}; _B = {};
    kopfPruefen_(T.MA);
    if (aktion === 'login') return ok(login_(daten.pin));
    var ich = nutzerAusToken_(token);
    if (!ich) return { ok: false, fehler: 'ANMELDUNG' };
    var f = AKTIONEN[aktion];
    if (!f) throw new Error('Unbekannte Aktion: ' + aktion);
    if (f.admin && ich.rolle !== 'admin') throw new Error('Keine Berechtigung');
    if (f.ohneLock) return ok(f.fn(ich, daten, token));
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return ok(f.fn(ich, daten, token));
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    return { ok: false, fehler: String(e && e.message || e) };
  }
}
function ok(x) { return { ok: true, daten: x }; }

var AKTIONEN = {
  start:          { fn: function (ich, d) { var r = startDaten_(ich); if (d && d.monat) r.monatDaten = monat_(ich, { monat: String(d.monat) }); return r; } },
  monat:          { fn: function (ich, d) { return monat_(ich, d); } },
  jahr:           { fn: function (ich, d) { return jahr_(ich, d); } },
  stempeln:       { fn: function (ich, d) { return stempeln_(ich, d); } },
  eintragSpeichern: { fn: function (ich, d) { return eintragSpeichern_(ich, d); } },
  eintragLoeschen:  { fn: function (ich, d) { return eintragLoeschen_(ich, d); } },
  abwesenheit:    { fn: function (ich, d) { return abwesenheit_(ich, d); } },
  tagAbschliessen:{ fn: function (ich, d) { return tagAbschluss_(ich, d, true); } },
  tagOeffnen:     { fn: function (ich, d) { return tagAbschluss_(ich, d, false); } },
  meldungen:      { fn: function (ich, d) { return meldungen_(ich); } },
  meldungSenden:  { fn: function (ich, d) { return meldungSenden_(ich, d); } },
  meldungGelesen: { fn: function (ich, d) { return meldungGelesen_(ich, d); } },
  benachrichtigung: { fn: function (ich, d) { return { thema: ntfyThema_(ich.id), server: 'ntfy.sh' }; } },
  pushTest:       { fn: function (ich, d) { ntfyThema_(ich.id); pushSenden_(ich.id, '🔔 Zeiterfassung', 'Test ✓ – Meldungen kommen an', 3); return true; } },
  abmelden:       { fn: function (ich, d, token) { PropertiesService.getScriptProperties().deleteProperty('T_' + token); return true; } },
  // nur Admin
  uebersicht:     { admin: true, fn: function (ich, d) { return uebersicht_(d); } },
  baustelleSpeichern: { admin: true, fn: function (ich, d) { return baustelleSpeichern_(d); } },
  baustelleLoeschen: { admin: true, fn: function (ich, d) { return baustelleLoeschen_(d); } },
  mitarbeiterSpeichern: { admin: true, fn: function (ich, d) { return mitarbeiterSpeichern_(d); } },
  monatsbericht:  { admin: true, fn: function (ich, d) { return monatsbericht_(d); } },
  monatEntsperren:{ admin: true, fn: function (ich, d) { return monatEntsperren_(d); } },
  kalender:       { admin: true, fn: function (ich, d) { return kalender_(d); } },
  kiSprache:      { ohneLock: true, fn: function (ich, d) { return kiSprache_(ich, d); } },
  kiFoto:         { ohneLock: true, fn: function (ich, d) { return kiFoto_(ich, d); } },
  belegHochladen: { ohneLock: true, fn: function (ich, d) { return belegHochladen_(ich, d); } },
  abrechnung:     { admin: true, fn: function (ich, d) { return abrechnung_(d); } },
  abrechnungTabelle: { admin: true, fn: function (ich, d) { return abrechnungTabelle_(d); } },
  kiSchluessel:   { admin: true, fn: function (ich, d) { return kiSchluessel_(d); } },
  kiDiagnose:     { admin: true, ohneLock: true, fn: function (ich, d) { return kiDiagnose_(d); } }
};

/* ============================ KI (Google Gemini) ============================ */

// Lite zuerst: schnell und kaum überlastet; das große Modell nur als Ersatz
var KI_MODELLE = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
var KI_EINHEITEN = 'Stk, m, Pkt, Rolle, kg, Sack';

function kiSchluessel_(d) {
  var k = String(d.schluessel || '').trim(), props = PropertiesService.getScriptProperties();
  if (!k) { props.deleteProperty('KI_KEY'); return { kiAktiv: false }; }
  k = k.replace(/\s+/g, '');
  if (!/^[\w.\-]{20,200}$/.test(k)) throw new Error('Schlüssel sieht nicht richtig aus');
  var alt = props.getProperty('KI_KEY');
  props.setProperty('KI_KEY', k);
  try { kiFrage_([{ text: 'Antworte nur mit {"ok":true}' }]); }
  catch (x) { if (x.message === 'KI_BESETZT' || x.message === 'KI_LIMIT') return { kiAktiv: true };
    if (alt) props.setProperty('KI_KEY', alt); else props.deleteProperty('KI_KEY'); throw new Error('Schlüssel funktioniert nicht: ' + x.message); }
  return { kiAktiv: true };
}
function kiDiagnose_(d) {
  var key = PropertiesService.getScriptProperties().getProperty('KI_KEY'), aus = [];
  (d && d.modell ? [String(d.modell)] : KI_MODELLE).forEach(function (mo) {
    var t0 = Date.now();
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + mo + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Antworte nur mit {"ok":true}' }] }], generationConfig: kiConfig_(mo) }) });
    aus.push(mo + ': ' + r.getResponseCode() + ' in ' + (Date.now() - t0) + ' ms ' + (r.getResponseCode() === 200 ? '' : r.getContentText().slice(0, 120)));
  });
  return aus;
}
function kiConfig_(modell) {
  var c = { responseMimeType: 'application/json', temperature: 0.2 };
  if (/2\.5/.test(modell)) c.thinkingConfig = { thinkingBudget: 0 };
  else c.thinkingConfig = { thinkingLevel: 'low' };
  return c;
}
function kiAktiv_() { return !!PropertiesService.getScriptProperties().getProperty('KI_KEY'); }

/** Schickt Teile (Text/Bild/Audio) an Gemini und gibt das JSON der Antwort zurück. */
function kiFrage_(teile) {
  var key = PropertiesService.getScriptProperties().getProperty('KI_KEY');
  if (!key) throw new Error('KI_FEHLT');
  var letzter = '';
  for (var i = 0; i < KI_MODELLE.length; i++) {
    var t0 = Date.now();
    var r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + KI_MODELLE[i] + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({ contents: [{ role: 'user', parts: teile }],
        generationConfig: kiConfig_(KI_MODELLE[i]) })
    });
    var code = r.getResponseCode(), txt = r.getContentText();
    console.log('KI ' + KI_MODELLE[i] + ' → ' + code + ' in ' + (Date.now() - t0) + ' ms');
    if (code === 200) {
      var j = JSON.parse(txt), c = j.candidates && j.candidates[0];
      var t = c && c.content && c.content.parts ? c.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
      t = t.replace(/^```(json)?/i, '').replace(/```\s*$/, '').trim();
      return JSON.parse(t || '{}');
    }
    letzter = code + ' ' + txt.slice(0, 200);
    if (code === 401 || code === 403 || /API_KEY_INVALID|API key not valid/i.test(txt)) throw new Error('KI_SCHLUESSEL: ' + letzter);
    if (code >= 500 && !i) Utilities.sleep(800);
    // 404 (Modell gibt es nicht), 429 (Limit), 5xx (überlastet) → nächstes Modell versuchen
  }
  if (/^429/.test(letzter)) throw new Error('KI_LIMIT');
  if (/^5\d\d/.test(letzter)) throw new Error('KI_BESETZT');
  throw new Error('KI: ' + letzter);
}
function kiDatei_(d, art) {
  var b64 = String(d.daten || ''), mime = String(d.mime || '');
  if (!b64) throw new Error('Keine Datei');
  if (b64.length > 9 * 1024 * 1024) throw new Error('Datei zu groß');
  if (art === 'audio' && !/^audio\//.test(mime)) mime = 'audio/webm';
  mime = mime.split(';')[0];
  if (art === 'bild' && !/^image\//.test(mime)) mime = 'image/jpeg';
  return { inline_data: { mime_type: mime, data: b64 } };
}
function bsName_(id) { var b = id ? finde_(T.BS, id) : null; return b ? b.name : ''; }
function matSauber_(liste) {
  return (liste || []).filter(function (m) { return m && String(m.text || '').trim(); }).slice(0, 30).map(function (m) {
    var e = String(m.einheit || 'Stk'); if (['Stk', 'm', 'Pkt', 'Rolle', 'kg', 'Sack'].indexOf(e) < 0) e = 'Stk';
    var o = { menge: m.menge == null ? '' : String(m.menge).replace('.', ','), einheit: e, text: String(m.text).trim().slice(0, 120) };
    if (m.preis != null && m.preis !== '' && !isNaN(Number(m.preis))) o.preis = Math.round(Number(m.preis) * 100) / 100;
    return o;
  });
}
var KI_ROLLE = 'Du hilfst in der Zeiterfassung eines kleinen Elektroinstallations-Betriebs in Deutschland. ' +
  'Mitarbeiter sprechen Deutsch oder Türkisch (oft gemischt). Ergebnisse IMMER auf Deutsch, in der Fachsprache eines Elektrikers ' +
  '(z. B. NYM-J 3x1,5, Hohlwanddose, Unterputzdose, Abzweigdose, Wago-Klemme, Schukosteckdose, Dübel 6 mm, Kabelkanal, FI/LS, Sicherungsautomat B16). ';

function kiSprache_(ich, d) {
  var feld = d.feld === 'material' ? 'material' : 'taetigkeit';
  var auftrag = feld === 'material'
    ? 'Höre die Sprachaufnahme an. Darin werden verbrauchte Materialien genannt. Gib sie als Liste zurück. ' +
      'Antworte als JSON: {"material":[{"menge":Zahl oder "","einheit":eine von ' + KI_EINHEITEN + ',"text":"saubere deutsche Bezeichnung"}],"gehoert":"was gesagt wurde (Originalsprache)"}. ' +
      'Meter → m, Stück/adet → Stk, Paket → Pkt, Rolle/rulo → Rolle. Zahlwörter in Zahlen umwandeln. Nichts erfinden.'
    : 'Höre die Sprachaufnahme an. Darin beschreibt jemand, was er heute auf der Baustelle gemacht hat. ' +
      'Schreibe daraus einen kurzen, sauberen deutschen Text für einen Stundenzettel (Stichpunkte mit Komma oder kurze Sätze, keine Füllwörter, korrekte Rechtschreibung). ' +
      'Antworte als JSON: {"text":"deutscher Text","tr":"dieselbe Bedeutung kurz auf Türkisch","gehoert":"was gesagt wurde (Originalsprache)"}. Nichts erfinden.';
  var r = kiFrage_([{ text: KI_ROLLE + auftrag }, kiDatei_(d, 'audio')]);
  if (feld === 'material') return { material: matSauber_(r.material), gehoert: String(r.gehoert || '') };
  return { text: String(r.text || '').trim().slice(0, 500), tr: String(r.tr || ''), gehoert: String(r.gehoert || '') };
}

function kiFoto_(ich, d) {
  var auftrag = 'Auf dem Foto ist Material von der Baustelle (z. B. Kabel, Dosen, Schalter, Dübel, Schrauben, Klemmen, Leuchtmittel) – ' +
    'oft mit Etikett, Aufdruck oder Barcode. Erkenne, was es ist, und lies, wenn sichtbar, Hersteller, Typ, Artikelnummer und EAN-Barcode ab. ' +
    'Wenn eine Packungsgröße oder Ringlänge erkennbar ist, nutze sie als Vorschlag für die Menge, sonst menge "". ' +
    'Antworte als JSON: {"material":[{"menge":Zahl oder "","einheit":eine von ' + KI_EINHEITEN + ',"text":"kurze deutsche Bezeichnung wie ein Elektriker sie schreibt, inkl. Typ/Größe"}],' +
    '"ean":"Barcode-Nummer falls lesbar sonst leer","sicher":true/false}. Mehrere verschiedene Artikel auf dem Foto = mehrere Einträge. Nichts erfinden; wenn unklar, beschreibe es allgemein.';
  var r = kiFrage_([{ text: KI_ROLLE + auftrag }, kiDatei_(d, 'bild')]);
  return { material: matSauber_(r.material), ean: String(r.ean || ''), sicher: r.sicher !== false };
}

function belegHochladen_(ich, d) {
  var datum = /^\d{4}-\d{2}-\d{2}$/.test(String(d.datum)) ? String(d.datum) : heute_();
  var teil = kiDatei_(d, 'bild');
  var ma = finde_(T.MA, ich.id);
  var name = datum + '_' + (bsName_(d.baustelle) || 'Beleg').replace(/[\\\/:*?"<>|]/g, '-').slice(0, 40) + '_' + ((ma && ma.name) || ich.id).split(' ')[0] + '_' + Utilities.formatDate(new Date(), APP.zeitzone, 'HHmmss') + '.jpg';
  var blob = Utilities.newBlob(Utilities.base64Decode(teil.inline_data.data), teil.inline_data.mime_type, name);
  var root = ordner_(DriveApp.getRootFolder(), APP.ordner);
  var ziel = ordner_(ordner_(ordner_(root, 'Belege'), datum.slice(0, 4)), datum.slice(0, 7));
  var f = ziel.createFile(blob);
  var aus = { beleg: { id: f.getId(), name: name }, material: [], summe: '', haendler: '' };
  if (kiAktiv_()) {
    try {
      var r = kiFrage_([{ text: KI_ROLLE + 'Das ist ein Kassenbon oder eine Rechnung über Material-Einkauf. Lies die gekauften Positionen ab. ' +
        'Antworte als JSON: {"haendler":"Name des Geschäfts","summe":Gesamtbetrag brutto als Zahl,"material":[{"menge":Zahl,"einheit":eine von ' + KI_EINHEITEN + ',"text":"verständliche deutsche Bezeichnung","preis":Gesamtpreis der Position brutto als Zahl}]}. Nichts erfinden.' }, teil]);
      aus.material = matSauber_(r.material); aus.summe = r.summe || ''; aus.haendler = String(r.haendler || '');
      f.setDescription((aus.haendler ? aus.haendler + ' · ' : '') + (aus.summe ? aus.summe + ' €' : ''));
    } catch (x) { aus.kiFehler = String(x.message || x); }
  }
  if (ich.rolle !== 'admin') pushAnAdmin_('🧾 Beleg von ' + ((ma && ma.name) || ich.id), (aus.haendler ? aus.haendler + ' · ' : '') + (aus.summe ? aus.summe + ' € · ' : '') + (bsName_(d.baustelle) || datum));
  return aus;
}
function pushAnAdmin_(titel, text) {
  try { zeilen_(T.MA).filter(function (m) { return m.rolle === 'admin' && m.aktiv !== 'nein'; }).forEach(function (m) { pushSenden_(m.id, titel, text, 3); }); } catch (x) {}
}

/* ============================ Google Kalender (Mini-Fenster) ============================ */

function kalender_(d) {
  var mo = String(d.monat || Utilities.formatDate(new Date(), APP_TZ_(), 'yyyy-MM'));
  if (!/^\d{4}-\d{2}$/.test(mo)) throw new Error('Monat ungültig');
  var cache = CacheService.getScriptCache(), key = 'KAL_' + mo;
  if (!d.frisch) { var c = cache.get(key); if (c) return JSON.parse(c); }
  var j = +mo.slice(0, 4), m = +mo.slice(5, 7) - 1;
  var von = new Date(j, m, 1), bis = new Date(j, m + 1, 1);
  von.setDate(von.getDate() - 7); bis.setDate(bis.getDate() + 14);
  var tz = APP_TZ_(), aus = [];
  CalendarApp.getAllOwnedCalendars().forEach(function (kal) {
    if (kal.isHidden && kal.isHidden()) return;
    var kfarbe = kal.getColor();
    kal.getEvents(von, bis).forEach(function (e) {
      var ganz = e.isAllDayEvent(), s = e.getStartTime(), en = e.getEndTime();
      if (ganz) en = new Date(en.getTime() - 1000);
      var titel = e.getTitle() || '(ohne Titel)', f = String(e.getColor() || '');
      aus.push({
        von: Utilities.formatDate(s, tz, 'yyyy-MM-dd'),
        bis: Utilities.formatDate(en, tz, 'yyyy-MM-dd'),
        zeit: ganz ? '' : Utilities.formatDate(s, tz, 'HH:mm'),
        titel: titel, ort: e.getLocation() || '',
        wichtig: f === '11' || f === '4' || /^\s*!/.test(titel),
        farbe: kfarbe
      });
    });
  });
  aus.sort(function (a, b) { return (a.von + a.zeit) < (b.von + b.zeit) ? -1 : 1; });
  var r = { monat: mo, termine: aus };
  try { cache.put(key, JSON.stringify(r), 120); } catch (x) {}
  return r;
}
function APP_TZ_() { return APP.zeitzone; }

/** Einmal im Editor ausführen, damit Google den Kalender-Zugriff erlaubt. */
function kalenderFreigeben() { Logger.log(CalendarApp.getDefaultCalendar().getName()); }

/* ============================ Anmeldung ============================ */

function login_(pin) {
  pin = String(pin || '').trim();
  var cache = CacheService.getScriptCache();
  var fehlversuche = Number(cache.get('fehl') || 0);
  if (fehlversuche >= 10) throw new Error('ZU_VIELE_VERSUCHE');
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN_FALSCH');
  var hash = hash_(pin);
  var ma = zeilen_(T.MA).filter(function (m) { return m.pinHash === hash && m.aktiv !== 'nein'; })[0];
  if (!ma) {
    cache.put('fehl', String(fehlversuche + 1), 900);
    throw new Error('PIN_FALSCH');
  }
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var ablauf = Date.now() + APP.tokenTage * 864e5;
  PropertiesService.getScriptProperties().setProperty('T_' + token, JSON.stringify({ ma: ma.id, ablauf: ablauf }));
  var ich = oeffentlich_(ma);
  // alles Nötige gleich mitliefern, damit die App nach der Anmeldung sofort startet
  return { token: token, nutzer: ich, start: startDaten_(ich), monat: monat_(ich, { monat: heute_().slice(0, 7) }) };
}

function nutzerAusToken_(token) {
  if (!token) return null;
  var roh = PropertiesService.getScriptProperties().getProperty('T_' + token);
  if (!roh) return null;
  var t = JSON.parse(roh);
  if (t.ablauf < Date.now()) return null;
  var ma = zeilen_(T.MA).filter(function (m) { return m.id === t.ma && m.aktiv !== 'nein'; })[0];
  return ma ? oeffentlich_(ma) : null;
}

function oeffentlich_(m) { return { id: m.id, name: m.name, rolle: m.rolle, sprache: m.sprache || 'de' }; }

function hash_(pin) {
  var salz = PropertiesService.getScriptProperties().getProperty('SALZ') || '';
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salz + '|' + pin);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}

/* ============================ Daten laden ============================ */

function startDaten_(ich) {
  var r = {
    nutzer: ich,
    baustellen: zeilen_(T.BS).filter(function (b) { return b.aktiv !== 'nein'; }).map(function (b) { return { id: b.id, name: b.name, adresse: b.adresse }; }),
    heute: heute_(),
    ungelesen: ungelesen_(ich),
    kiAktiv: kiAktiv_()
  };
  if (ich.rolle === 'admin') {
    r.mitarbeiter = zeilen_(T.MA).map(function (m) { var o = oeffentlich_(m); o.aktiv = m.aktiv !== 'nein';
      o.urlaubJahr = Number(m.urlaubJahr || 0); o.urlaubStartGenommen = Number(m.urlaubStartGenommen || 0); o.urlaubStartJahr = m.urlaubStartJahr || ''; return o; });
    r.alleBaustellen = zeilen_(T.BS).map(function (b) { return { id: b.id, name: b.name, adresse: b.adresse, aktiv: b.aktiv !== 'nein' }; });
  }
  return r;
}

/** Alle Einträge eines Monats (Mitarbeiter sehen nur sich selbst). */
function monat_(ich, d) {
  var ma = welcherMa_(ich, d.ma);
  var praefix = String(d.monat); // 'YYYY-MM'
  var eintraege = zeilen_(T.E).filter(function (e) { return e.ma === ma && String(e.datum).indexOf(praefix) === 0; }).map(eintragAus_);
  var tage = zeilen_(T.TAG).filter(function (t) { return t.ma === ma && String(t.datum).indexOf(praefix) === 0; }).map(function (t) { return t.datum; });
  return { ma: ma, monat: praefix, eintraege: eintraege, abgeschlossen: tage, gesperrt: istGesperrt_(ma, praefix), laufend: laufend_(ma), urlaubKonto: urlaubKonto_(ma, praefix.slice(0, 4)) };
}

/** Alle Urlaubs- und Krankheitstage eines Jahres (für den Filter im Kalender). */
function jahr_(ich, d) {
  var ma = welcherMa_(ich, d.ma), j = String(d.jahr);
  var tage = zeilen_(T.E).filter(function (e) { return e.ma === ma && (e.typ === 'U' || e.typ === 'K') && String(e.datum).indexOf(j) === 0; })
    .map(function (e) { return { id: e.id, datum: e.datum, typ: e.typ }; })
    .sort(function (a, b) { return a.datum < b.datum ? -1 : 1; });
  return { ma: ma, jahr: j, tage: tage, urlaubKonto: urlaubKonto_(ma, j) };
}

function welcherMa_(ich, gewuenscht) {
  if (ich.rolle === 'admin' && gewuenscht) return String(gewuenscht);
  return ich.id; // Mitarbeiter bekommt immer nur die eigenen Daten
}

function eintragAus_(e) {
  var m = [];
  try { m = e.material ? JSON.parse(e.material) : []; } catch (x) { m = [{ menge: '', einheit: '', text: String(e.material) }]; }
  return {
    id: e.id, ma: e.ma, datum: e.datum, typ: e.typ || 'A', baustelle: e.baustelle,
    start: e.start, ende: e.ende, pause: Number(e.pause || 0), pauseStart: e.pauseStart || '',
    taetigkeit: e.taetigkeit, material: m, km: e.km === '' ? '' : Number(e.km || 0),
    belege: belegeLesen_(e.belege)
  };
}

function laufend_(ma) {
  var l = zeilen_(T.E).filter(function (e) { return e.ma === ma && e.typ === 'A' && e.start && !e.ende; });
  return l.length ? eintragAus_(l[l.length - 1]) : null;
}

/* ============================ Stempeln ============================ */

/**
 * d.art: 'beginn' | 'pause' | 'weiter' | 'ende' | 'wechsel'
 * d.zeit: 'HH:mm' (Uhrzeit vom Handy, damit Offline-Buchungen stimmen)
 * d.datum: 'YYYY-MM-DD', d.id: Kennung für neuen Eintrag (vom Handy erzeugt)
 */
function stempeln_(ich, d) {
  pruefeZeit_(d.zeit);
  var l = laufend_(ich.id);
  // Beim Beenden/Pausieren zählt das Datum des laufenden Eintrags, nicht das vom Handy
  if (d.art !== 'beginn' && d.art !== 'wechsel') d.datum = l ? l.datum : heute_();
  pruefeDatum_(d.datum);
  if (d.art === 'beginn' || d.art === 'wechsel') {
    if (!d.id) throw new Error('Kennung fehlt');
    if (finde_(T.E, d.id)) return monat_(ich, { monat: d.datum.slice(0, 7) }); // schon angekommen (Wiederholung)
    if (!d.baustelle) throw new Error('BAUSTELLE_FEHLT');
    pruefeSperre_(ich, ich.id, d.datum);
    if (d.art === 'wechsel' && l) beenden_(l, d.zeit);
    else if (l) throw new Error('LAEUFT_SCHON');
    tagWiederOeffnen_(ich.id, d.datum);
    schreiben_(T.E, { id: d.id, ma: ich.id, datum: d.datum, typ: 'A', baustelle: d.baustelle, start: d.zeit, ende: '', pause: 0, pauseStart: '', taetigkeit: '', material: '[]', km: '', geaendert: jetzt_() });
  } else {
    if (!l) return monat_(ich, { monat: d.datum.slice(0, 7) }); // nichts läuft (evtl. schon gebucht)
    if (d.art === 'pause' && !l.pauseStart) aktualisieren_(T.E, l.id, { pauseStart: d.zeit, geaendert: jetzt_() });
    if (d.art === 'weiter' && l.pauseStart) aktualisieren_(T.E, l.id, { pause: l.pause + minDiff_(l.pauseStart, d.zeit), pauseStart: '', geaendert: jetzt_() });
    if (d.art === 'ende') beenden_(l, d.zeit);
  }
  return monat_(ich, { monat: d.datum.slice(0, 7) });
}

function beenden_(l, zeit) {
  var pause = l.pause;
  if (l.pauseStart) pause += minDiff_(l.pauseStart, zeit);
  aktualisieren_(T.E, l.id, { ende: zeit, pause: pause, pauseStart: '', geaendert: jetzt_() });
}

/* ============================ Einträge ============================ */

function eintragSpeichern_(ich, d) {
  kopfPruefen_(T.E);
  var e = d.eintrag;
  var alt = e.id ? finde_(T.E, e.id) : null;
  var ma = alt ? alt.ma : welcherMa_(ich, e.ma);
  if (alt && ich.rolle !== 'admin' && alt.ma !== ich.id) throw new Error('Keine Berechtigung');
  pruefeDatum_(e.datum);
  pruefeSperre_(ich, ma, e.datum);
  if (alt) pruefeSperre_(ich, ma, alt.datum);
  var typ = ['A', 'U', 'K'].indexOf(e.typ) >= 0 ? e.typ : 'A';
  if (typ === 'A') {
    if (!e.baustelle) throw new Error('BAUSTELLE_FEHLT');
    pruefeZeit_(e.start);
    if (e.ende) { pruefeZeit_(e.ende); if (minDiff_(e.start, e.ende) <= 0) throw new Error('ENDE_VOR_BEGINN'); }
  }
  var material = (e.material || []).filter(function (m) { return m && String(m.text || '').trim(); })
    .map(function (m) {
      var o = { menge: String(m.menge || '').slice(0, 10), einheit: String(m.einheit || '').slice(0, 10), text: String(m.text).slice(0, 120) };
      var p = String(m.preis == null ? '' : m.preis).replace(',', '.').trim();
      if (p !== '' && !isNaN(Number(p))) o.preis = Math.round(Number(p) * 100) / 100;
      return o;
    });
  var belege = (e.belege || []).filter(function (b) { return b && /^[\w-]{10,}$/.test(String(b.id)); })
    .map(function (b) { return { id: String(b.id), name: String(b.name || 'Beleg').slice(0, 80) }; }).slice(0, 20);
  var obj = {
    id: e.id || Utilities.getUuid(), ma: ma, datum: e.datum, typ: typ,
    baustelle: typ === 'A' ? e.baustelle : '',
    start: typ === 'A' ? e.start : '', ende: typ === 'A' ? (e.ende || '') : '',
    pause: typ === 'A' ? Math.max(0, Number(e.pause || 0)) : 0,
    pauseStart: alt && typ === 'A' && !e.ende ? alt.pauseStart : '',
    taetigkeit: String(e.taetigkeit || '').slice(0, 500),
    material: JSON.stringify(material),
    km: e.km === '' || e.km == null ? '' : Math.max(0, Number(e.km) || 0),
    geaendert: jetzt_(),
    belege: belege.length ? JSON.stringify(belege) : ''
  };
  if (alt) aktualisieren_(T.E, obj.id, obj); else { schreiben_(T.E, obj); if (typ === 'A') tagWiederOeffnen_(ma, e.datum); }
  return monat_(ich, { ma: ma, monat: e.datum.slice(0, 7) });
}

function eintragLoeschen_(ich, d) {
  var alt = finde_(T.E, d.id);
  if (!alt) return monat_(ich, { ma: d.ma, monat: d.monat });
  if (ich.rolle !== 'admin' && alt.ma !== ich.id) throw new Error('Keine Berechtigung');
  pruefeSperre_(ich, alt.ma, alt.datum);
  loeschen_(T.E, d.id);
  return monat_(ich, { ma: alt.ma, monat: alt.datum.slice(0, 7) });
}

/** Urlaub/Krank für einen Zeitraum (nur Mo–Fr, ohne Feiertage NRW). */
function abwesenheit_(ich, d) {
  var ma = welcherMa_(ich, d.ma);
  pruefeDatum_(d.von); pruefeDatum_(d.bis);
  if (['U', 'K'].indexOf(d.typ) < 0) throw new Error('Falsche Art');
  var vorhanden = zeilen_(T.E).filter(function (e) { return e.ma === ma && (e.typ === 'U' || e.typ === 'K'); })
    .map(function (e) { return e.datum; });
  var tag = new Date(d.von + 'T12:00:00'), bis = new Date(d.bis + 'T12:00:00'), n = 0;
  while (tag <= bis && n < 62) {
    var s = isoDatum_(tag), wt = tag.getDay();
    if (wt !== 0 && wt !== 6 && !feiertag_(s) && vorhanden.indexOf(s) < 0) {
      pruefeSperre_(ich, ma, s);
      schreiben_(T.E, { id: Utilities.getUuid(), ma: ma, datum: s, typ: d.typ, baustelle: '', start: '', ende: '', pause: 0, pauseStart: '', taetigkeit: '', material: '[]', km: '', geaendert: jetzt_() });
    }
    tag.setDate(tag.getDate() + 1); n++;
  }
  return monat_(ich, { ma: ma, monat: d.von.slice(0, 7) });
}

/** Neue Arbeit an einem abgeschlossenen Tag → Tag wieder offen, damit er neu geprüft wird. */
function tagWiederOeffnen_(ma, datum) {
  var sh = blatt_(T.TAG), werte = sh.getDataRange().getValues();
  for (var i = werte.length - 1; i >= 1; i--) if (String(werte[i][0]) === ma && wert_(werte[i][1], 'datum') === datum) sh.deleteRow(i + 1);
}

function tagAbschluss_(ich, d, schliessen) {
  var ma = welcherMa_(ich, d.ma);
  pruefeDatum_(d.datum);
  pruefeSperre_(ich, ma, d.datum);
  var sh = blatt_(T.TAG), werte = sh.getDataRange().getValues();
  for (var i = werte.length - 1; i >= 1; i--) if (String(werte[i][0]) === ma && wert_(werte[i][1], 'datum') === d.datum) sh.deleteRow(i + 1);
  if (schliessen) {
    var l = laufend_(ma);
    if (l && l.datum === d.datum) throw new Error('LAEUFT_NOCH');
    textZeile_(sh, [ma, d.datum, jetzt_()]);
  }
  return monat_(ich, { ma: ma, monat: d.datum.slice(0, 7) });
}

/* ============================ Admin ============================ */

function uebersicht_(d) {
  var monat = String(d.monat);
  var alle = zeilen_(T.E).filter(function (e) { return String(e.datum).indexOf(monat) === 0; });
  var tage = zeilen_(T.TAG).filter(function (t) { return String(t.datum).indexOf(monat) === 0; });
  return zeilen_(T.MA).filter(function (m) { return m.aktiv !== 'nein'; }).map(function (m) {
    var e = alle.filter(function (x) { return x.ma === m.id; });
    var s = summen_(e.map(eintragAus_));
    var arbeitstage = {};
    e.forEach(function (x) { if (x.typ === 'A') arbeitstage[x.datum] = 1; });
    var zu = tage.filter(function (t) { return t.ma === m.id; }).map(function (t) { return t.datum; });
    var offen = Object.keys(arbeitstage).filter(function (t) { return zu.indexOf(t) < 0; }).length;
    var sp = sperre_(m.id, monat);
    var pausenTage = Object.keys(arbeitstage).filter(function (t) {
      var a = e.filter(function (x) { return x.datum === t && x.typ === 'A' && x.ende; }).map(eintragAus_);
      var h = a.reduce(function (s, x) { return s + stunden_(x); }, 0), p = a.reduce(function (s, x) { return s + x.pause; }, 0);
      return p < (h > 9 ? 45 : (h > 6 ? 30 : 0));
    }).sort();
    return { id: m.id, pausenTage: pausenTage, name: m.name, stunden: s.stunden, urlaub: s.urlaub, krank: s.krank, km: s.km, tage: Object.keys(arbeitstage).length, offen: offen,
      urlaubKonto: urlaubKonto_(m.id, monat.slice(0, 4)), gesperrt: istGesperrt_(m.id, monat), pdfUrl: sp && sp.pdfId ? 'https://drive.google.com/file/d/' + sp.pdfId + '/view' : '', tabelleUrl: sp && sp.tabelleId ? 'https://docs.google.com/spreadsheets/d/' + sp.tabelleId + '/edit' : '' };
  });
}

function baustelleSpeichern_(d) {
  var b = d.baustelle;
  var name = String(b.name || '').trim();
  if (!name) throw new Error('Name fehlt');
  var adresse = String(b.adresse || '').trim();
  if (b.id && finde_(T.BS, b.id)) aktualisieren_(T.BS, b.id, { name: name, adresse: adresse, aktiv: b.aktiv === false ? 'nein' : 'ja' });
  else {
    var gleich = function (x, y) { return String(x || '').trim().toLowerCase() === String(y || '').trim().toLowerCase(); };
    var doppelt = zeilen_(T.BS).some(function (x) { return gleich(x.name, name) && gleich(x.adresse, adresse); });
    if (!doppelt) schreiben_(T.BS, { id: Utilities.getUuid().slice(0, 8), name: name, adresse: adresse, aktiv: 'ja', erstellt: jetzt_() });
  }
  return startDaten_({ rolle: 'admin' });
}

/** Baustelle löschen – nur wenn noch keine Stunden darauf gebucht sind. */
function baustelleLoeschen_(d) {
  var id = String(d.id || '');
  if (zeilen_(T.E).some(function (e) { return e.baustelle === id; })) throw new Error('Auf dieser Baustelle sind schon Stunden gebucht. Bitte stattdessen auf „beendet“ setzen.');
  loeschen_(T.BS, id);
  return startDaten_({ rolle: 'admin' });
}

function mitarbeiterSpeichern_(d) {
  var m = d.mitarbeiter;
  var name = String(m.name || '').trim();
  if (!name) throw new Error('Name fehlt');
  var obj = { name: name, rolle: m.rolle === 'admin' ? 'admin' : 'mitarbeiter', sprache: m.sprache === 'tr' ? 'tr' : 'de', aktiv: m.aktiv === false ? 'nein' : 'ja' };
  if (m.urlaubJahr !== undefined && m.urlaubJahr !== '') obj.urlaubJahr = Math.max(0, Number(m.urlaubJahr) || 0);
  if (m.urlaubStartGenommen !== undefined && m.urlaubStartGenommen !== '') { obj.urlaubStartGenommen = Math.max(0, Number(m.urlaubStartGenommen) || 0); obj.urlaubStartJahr = heute_().slice(0, 4); }
  if (m.pin) {
    if (!/^\d{4,8}$/.test(String(m.pin))) throw new Error('PIN muss 4–8 Ziffern haben');
    var h = hash_(String(m.pin));
    var doppelt = zeilen_(T.MA).filter(function (x) { return x.pinHash === h && x.id !== m.id; });
    if (doppelt.length) throw new Error('Diese PIN ist schon vergeben');
    obj.pinHash = h;
  }
  if (m.id && finde_(T.MA, m.id)) aktualisieren_(T.MA, m.id, obj);
  else {
    if (!obj.pinHash) throw new Error('PIN fehlt');
    obj.id = Utilities.getUuid().slice(0, 8);
    schreiben_(T.MA, obj);
  }
  return startDaten_({ rolle: 'admin' });
}

function monatEntsperren_(d) {
  var sh = blatt_(T.SP), w = sh.getDataRange().getValues();
  for (var i = w.length - 1; i >= 1; i--) if (String(w[i][0]) === d.ma && wert_(w[i][1], 'monat') === d.monat) sh.deleteRow(i + 1);
  return uebersicht_(d);
}

/* ============================ Monatsbericht ============================ */

function monatsbericht_(d) {
  var maId = String(d.ma), monat = String(d.monat);
  var ma = finde_(T.MA, maId);
  if (!ma) throw new Error('Mitarbeiter nicht gefunden');
  var j = Number(monat.slice(0, 4)), mo = Number(monat.slice(5, 7));
  var eintraege = zeilen_(T.E).filter(function (e) { return e.ma === maId && String(e.datum).indexOf(monat) === 0; }).map(eintragAus_);
  var laufende = eintraege.filter(function (e) { return e.typ === 'A' && !e.ende; });
  if (laufende.length) throw new Error('Am ' + deDatum_(laufende[0].datum) + ' fehlt noch die Endzeit.');
  var bsName = {};
  zeilen_(T.BS).forEach(function (b) { bsName[b.id] = b.name; });

  // Ordner: Zeiterfassung / Monatsberichte / JJJJ
  var basis = ordner_(DriveApp.getRootFolder(), APP.ordner);
  var ziel = ordner_(ordner_(basis, 'Monatsberichte'), String(j));
  var titel = 'Stundennachweis ' + monat + ' ' + ma.name;
  // alte Fassung löschen (keine doppelten Dateien)
  ['', '.pdf'].forEach(function (endung) {
    var it = ziel.getFilesByName(titel + endung);
    while (it.hasNext()) it.next().setTrashed(true);
  });

  var ss = SpreadsheetApp.create(titel);
  DriveApp.getFileById(ss.getId()).moveTo(ziel);
  var sh = ss.getSheets()[0];
  sh.setName(monat);
  sh.setHiddenGridlines(true);
  var monatsnamen = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  var wt = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  sh.getRange('A1').setValue('Stundennachweis').setFontSize(16).setFontWeight('bold');
  sh.getRange('A2').setValue(APP.firma).setFontColor('#555555');
  sh.getRange('A4:B6').setValues([['Mitarbeiter:', ma.name], ['Monat:', monatsnamen[mo - 1] + ' ' + j], ['Erstellt am:', Utilities.formatDate(new Date(), APP.zeitzone, 'dd.MM.yyyy')]]);
  sh.getRange('A4:A6').setFontWeight('bold');

  var kopf = ['Datum', 'Tag', 'Art', 'Baustelle', 'Beginn', 'Ende', 'Pause (Min.)', 'Stunden', 'km'];
  var zeilen = [kopf];
  var tageImMonat = new Date(j, mo, 0).getDate();
  var farben = [];
  for (var t = 1; t <= tageImMonat; t++) {
    var iso = monat + '-' + ('0' + t).slice(-2);
    var dt = new Date(j, mo - 1, t);
    var am = eintraege.filter(function (e) { return e.datum === iso; }).sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
    var ft = feiertag_(iso);
    if (!am.length) {
      var art = ft ? 'Feiertag (' + ft + ')' : (dt.getDay() === 0 || dt.getDay() === 6 ? '' : '–');
      zeilen.push([deDatum_(iso), wt[dt.getDay()], art, '', '', '', '', '', '']);
      farben.push(dt.getDay() === 0 || dt.getDay() === 6 || ft ? '#f1f1f1' : null);
      continue;
    }
    am.forEach(function (e) {
      if (e.typ === 'U' || e.typ === 'K') {
        zeilen.push([deDatum_(iso), wt[dt.getDay()], e.typ === 'U' ? 'Urlaub' : 'Krank', '', '', '', '', '', '']);
        farben.push(e.typ === 'U' ? '#e3efff' : '#ffe9e3');
      } else {
        zeilen.push([deDatum_(iso), wt[dt.getDay()], 'Arbeit', bsName[e.baustelle] || '', e.start, e.ende, e.pause || 0, Math.round(stunden_(e) * 100) / 100, e.km === '' ? '' : e.km]);
        farben.push(null);
      }
    });
  }
  var startZeile = 8;
  sh.getRange(startZeile, 1, zeilen.length, kopf.length).setValues(zeilen);
  sh.getRange(startZeile, 1, 1, kopf.length).setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
  farben.forEach(function (f, i) { if (f) sh.getRange(startZeile + 1 + i, 1, 1, kopf.length).setBackground(f); });
  sh.getRange(startZeile + 1, 8, zeilen.length - 1, 1).setNumberFormat('0.00');
  sh.getRange(startZeile, 1, zeilen.length, kopf.length).setBorder(true, true, true, true, true, true, '#cccccc', SpreadsheetApp.BorderStyle.SOLID);

  var s = summen_(eintraege);
  var z = startZeile + zeilen.length + 1;
  var uk = urlaubKonto_(maId, String(j));
  sh.getRange(z, 1, 6, 2).setValues([
    ['Arbeitsstunden gesamt:', Math.round(s.stunden * 100) / 100],
    ['Arbeitstage:', s.arbeitstage],
    ['Urlaubstage:', s.urlaub],
    ['Krankheitstage:', s.krank],
    ['Kilometer gesamt:', s.km],
    ['Resturlaub ' + j + ':', uk.anspruch ? uk.rest + ' von ' + uk.anspruch + ' Tagen' : '–']
  ]);
  sh.getRange(z, 1, 6, 1).setFontWeight('bold');
  sh.getRange(z, 2).setNumberFormat('0.00');

  var u = z + 7;
  sh.getRange(u, 1, 2, 6).setValues([['__________________________', '', '', '__________________________', '', ''], ['Datum, Unterschrift Mitarbeiter', '', '', 'Datum, Unterschrift Arbeitgeber', '', '']]);
  sh.getRange(u + 1, 1, 1, 6).setFontColor('#555555').setFontSize(9);

  [95, 35, 70, 190, 60, 60, 80, 65, 50].forEach(function (b, i) { sh.setColumnWidth(i + 1, b); });

  // Logo oben rechts (ca. 20 mm hoch)
  try {
    var logos = DriveApp.getFilesByName(APP.logoName);
    if (logos.hasNext()) {
      var bild = sh.insertImage(logos.next().getBlob(), 8, 1);
      var faktor = 76 / bild.getHeight();
      bild.setHeight(76).setWidth(Math.round(bild.getWidth() * faktor));
    }
  } catch (x) { /* ohne Logo weiter */ }

  SpreadsheetApp.flush();

  // PDF erzeugen
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&size=A4&portrait=true&fitw=true' +
    '&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED&fzr=false&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5&gid=' + sh.getSheetId();
  var pdf = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob().setName(titel + '.pdf');
  var pdfDatei = ziel.createFile(pdf);

  // Bericht merken; gesperrt wird der Monat für den Mitarbeiter erst, wenn er vorbei ist (siehe istGesperrt_)
  var sp = blatt_(T.SP), w = sp.getDataRange().getValues();
  for (var i = w.length - 1; i >= 1; i--) if (String(w[i][0]) === maId && wert_(w[i][1], 'monat') === monat) sp.deleteRow(i + 1);
  textZeile_(sp, [maId, monat, jetzt_(), ss.getId(), pdfDatei.getId()]);

  return { pdfUrl: pdfDatei.getUrl(), tabelleUrl: ss.getUrl(), uebersicht: uebersicht_({ monat: monat }) };
}

/* ============================ Berechnungen ============================ */

function stunden_(e) {
  if (e.typ !== 'A' || !e.start || !e.ende) return 0;
  return Math.max(0, minDiff_(e.start, e.ende) - Number(e.pause || 0)) / 60;
}

function summen_(liste) {
  var s = { stunden: 0, urlaub: 0, krank: 0, km: 0, arbeitstage: 0 }, tage = {};
  liste.forEach(function (e) {
    if (e.typ === 'U') s.urlaub++;
    else if (e.typ === 'K') s.krank++;
    else { s.stunden += stunden_(e); tage[e.datum] = 1; s.km += Number(e.km || 0); }
  });
  s.arbeitstage = Object.keys(tage).length;
  s.stunden = Math.round(s.stunden * 100) / 100;
  return s;
}

function minDiff_(a, b) {
  var x = a.split(':'), y = b.split(':');
  return (Number(y[0]) * 60 + Number(y[1])) - (Number(x[0]) * 60 + Number(x[1]));
}

/** Gesetzliche Feiertage NRW, gibt den Namen zurück oder ''. */
function feiertag_(iso) {
  var j = Number(iso.slice(0, 4));
  var fest = { '01-01': 'Neujahr', '05-01': 'Tag der Arbeit', '10-03': 'Tag der Dt. Einheit', '11-01': 'Allerheiligen', '12-25': '1. Weihnachtstag', '12-26': '2. Weihnachtstag' };
  if (fest[iso.slice(5)]) return fest[iso.slice(5)];
  var a = j % 19, b = Math.floor(j / 100), c = j % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mon = Math.floor((h + l - 7 * m + 114) / 31), tag = ((h + l - 7 * m + 114) % 31) + 1;
  var ostern = new Date(j, mon - 1, tag, 12);
  var bew = { '-2': 'Karfreitag', '1': 'Ostermontag', '39': 'Christi Himmelfahrt', '50': 'Pfingstmontag', '60': 'Fronleichnam' };
  for (var k2 in bew) {
    var x = new Date(ostern); x.setDate(x.getDate() + Number(k2));
    if (isoDatum_(x) === iso) return bew[k2];
  }
  return '';
}

/* ============================ Sperren & Prüfungen ============================ */

function sperre_(ma, monat) {
  return zeilen_(T.SP).filter(function (s) { return s.ma === ma && s.monat === monat; })[0] || null;
}
function istGesperrt_(ma, monat) { return !!sperre_(ma, monat) && String(monat) < heute_().slice(0, 7); }

/** Urlaubskonto eines Jahres: Anspruch, genommen (App + vor der App), Rest. */
function urlaubKonto_(maId, jahr) {
  var m = finde_(T.MA, maId) || {};
  var anspruch = Number(m.urlaubJahr || 0);
  var vorher = String(m.urlaubStartJahr || '') === String(jahr) ? Number(m.urlaubStartGenommen || 0) : 0;
  var app = zeilen_(T.E).filter(function (e) { return e.ma === maId && e.typ === 'U' && String(e.datum).indexOf(jahr) === 0; }).length;
  return { jahr: String(jahr), anspruch: anspruch, genommen: app + vorher, rest: anspruch - app - vorher };
}

/** Fehlende Spaltenköpfe ergänzen (für spätere Erweiterungen). */
function kopfPruefen_(t) {
  var sh = blatt_(t), n = sh.getLastColumn ? sh.getLastColumn() : t.kopf.length;
  if (n >= t.kopf.length) return;
  sh.getRange(1, 1, 1, t.kopf.length).setValues([t.kopf]);
  cacheLeeren_(t);
}
function pruefeSperre_(ich, ma, datum) {
  if (ich.rolle === 'admin') return;
  if (istGesperrt_(ma, String(datum).slice(0, 7))) throw new Error('MONAT_GESPERRT');
}
function pruefeZeit_(z) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(z))) throw new Error('Uhrzeit ungültig'); }
function pruefeDatum_(d) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw new Error('Datum ungültig'); }

/* ============================ Tabellen-Hilfen ============================ */

function db_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function blatt_(t) {
  if (_B[t.name]) return _B[t.name];
  var sh = db_().getSheetByName(t.name);
  if (!sh) {   // neue Tabellenblätter bei Erweiterungen automatisch anlegen
    sh = db_().insertSheet(t.name);
    sh.getRange(1, 1, sh.getMaxRows(), t.kopf.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, t.kopf.length).setValues([t.kopf]);
  }
  _B[t.name] = sh;
  return sh;
}

/* ============================ Nachrichten + Push (ntfy) ============================ */

function fuerMich_(ich, m) { return m.an === ich.id || (m.an === 'admin' && ich.rolle === 'admin'); }

function ungelesen_(ich) {
  return zeilen_(T.ME).filter(function (m) { return fuerMich_(ich, m) && !m.gelesen; }).length;
}

function meldungen_(ich) {
  var namen = {}; zeilen_(T.MA).forEach(function (m) { namen[m.id] = m.name; });
  var bs = {}; zeilen_(T.BS).forEach(function (b) { bs[b.id] = b.name; });
  var liste = zeilen_(T.ME).filter(function (m) { return fuerMich_(ich, m) || m.von === ich.id; })
    .sort(function (a, b) { return a.zeit < b.zeit ? 1 : -1; }).slice(0, 80)
    .map(function (m) { return { id: m.id, von: m.von, vonName: namen[m.von] || '', an: m.an, anName: m.an === 'admin' ? 'Chef' : (namen[m.an] || ''), zeit: m.zeit,
      baustelle: m.baustelle, baustelleName: bs[m.baustelle] || '', art: m.art, text: m.text, gelesen: m.gelesen, fuerMich: fuerMich_(ich, m) }; });
  return { liste: liste, ungelesen: ungelesen_(ich) };
}

function meldungSenden_(ich, d) {
  var text = String(d.text || '').trim().slice(0, 1000);
  if (!text) throw new Error('Text fehlt');
  var art = ['material', 'vorfall', 'sonstiges'].indexOf(d.art) >= 0 ? d.art : 'sonstiges';
  var an = 'admin';
  if (ich.rolle === 'admin' && d.an && d.an !== 'admin') { if (!finde_(T.MA, d.an)) throw new Error('Empfänger unbekannt'); an = String(d.an); }
  var m = { id: Utilities.getUuid(), von: ich.id, an: an, zeit: jetzt_(), baustelle: String(d.baustelle || ''), art: art, text: text, gelesen: '' };
  schreiben_(T.ME, m);
  var bsName = d.baustelle && finde_(T.BS, d.baustelle) ? finde_(T.BS, d.baustelle).name : '';
  var ziel = an === 'admin' ? zeilen_(T.MA).filter(function (x) { return x.rolle === 'admin' && x.aktiv !== 'nein'; }) : [finde_(T.MA, an)];
  var titel = { material: '📦 Material', vorfall: '⚠️ Vorfall', sonstiges: '💬 Nachricht' }[art] + (bsName ? ' – ' + bsName : '');
  ziel.forEach(function (x) { if (x && x.id !== ich.id) pushSenden_(x.id, titel, ich.name + ': ' + text, art === 'vorfall' ? 5 : 4); });
  return meldungen_(ich);
}

function meldungGelesen_(ich, d) {
  var m = finde_(T.ME, d.id);
  if (m && fuerMich_(ich, m)) aktualisieren_(T.ME, m.id, { gelesen: jetzt_() });
  return meldungen_(ich);
}

/** Persönliches, geheimes ntfy-Thema eines Nutzers (wird beim ersten Mal erzeugt). */
function ntfyThema_(maId) {
  var m = finde_(T.MA, maId);
  if (m && m.ntfy) return m.ntfy;
  var thema = 'soener-zeit-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  aktualisieren_(T.MA, maId, { ntfy: thema });
  return thema;
}

function pushSenden_(maId, titel, text, prio) {
  try {
    var m = finde_(T.MA, maId);
    if (!m || !m.ntfy) return;   // nur wer die Benachrichtigung eingerichtet hat
    UrlFetchApp.fetch('https://ntfy.sh/', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ topic: m.ntfy, title: titel, message: text.slice(0, 900), priority: prio || 4, click: APP.appUrl + '#nachrichten' }) });
  } catch (e) { /* Push ist ein Extra – Nachricht ist trotzdem gespeichert */ }
}

/** Google Tabellen wandeln "07:00" oder "2026-11-10" gern in Datum/Uhrzeit um – hier wieder in Text zurück. */
function wert_(v, k) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (k === 'start' || k === 'ende' || k === 'pauseStart') return Utilities.formatDate(v, APP.zeitzone, 'HH:mm');
    if (k === 'datum') return Utilities.formatDate(v, APP.zeitzone, 'yyyy-MM-dd');
    if (k === 'monat') return Utilities.formatDate(v, APP.zeitzone, 'yyyy-MM');
    return Utilities.formatDate(v, APP.zeitzone, 'yyyy-MM-dd HH:mm:ss');
  }
  return String(v);
}

/** Zeile als reinen Text anhängen (verhindert die automatische Umwandlung). */
function textZeile_(sh, werte) {
  var z = sh.getLastRow() + 1;
  sh.getRange(z, 1, 1, werte.length).setNumberFormat('@').setValues([werte.map(String)]);
}

/* Zwischenspeicher pro Anfrage: jede Tabelle wird nur einmal gelesen (schneller) */
var _C = {}, _B = {};
var CACHEBAR = { Mitarbeiter: 1, Baustellen: 1, Eintraege: 1, Nachrichten: 1 };
function cacheLeeren_(t) { if (t) delete _C[t.name]; else _C = {}; }

function zeilen_(t) {
  if (CACHEBAR[t.name] && _C[t.name]) return _C[t.name].slice();
  var r = zeilenLesen_(t);
  if (CACHEBAR[t.name]) _C[t.name] = r;
  return r.slice();
}

function zeilenLesen_(t) {
  var w = blatt_(t).getDataRange().getValues();
  var kopf = w[0];
  var r = [];
  for (var i = 1; i < w.length; i++) {
    if (w[i].join('') === '') continue;
    var o = {};
    for (var k = 0; k < kopf.length; k++) o[kopf[k]] = wert_(w[i][k], kopf[k]);
    r.push(o);
  }
  return r;
}

function finde_(t, id) { return zeilen_(t).filter(function (o) { return o.id === String(id); })[0] || null; }

function schreiben_(t, obj) {
  cacheLeeren_(t);
  textZeile_(blatt_(t), t.kopf.map(function (k) { return obj[k] === undefined ? '' : String(obj[k]); }));
}

function aktualisieren_(t, id, aend) {
  cacheLeeren_(t);
  var sh = blatt_(t), w = sh.getDataRange().getValues();
  for (var i = 1; i < w.length; i++) {
    if (String(w[i][0]) === String(id)) {
      var zeile = w[i].map(function (v, k) { var key = t.kopf[k]; return aend[key] === undefined ? wert_(v, key) : String(aend[key]); });
      sh.getRange(i + 1, 1, 1, zeile.length).setNumberFormat('@').setValues([zeile]);
      return;
    }
  }
}

function loeschen_(t, id) {
  cacheLeeren_(t);
  var sh = blatt_(t), w = sh.getDataRange().getValues();
  for (var i = w.length - 1; i >= 1; i--) if (String(w[i][0]) === String(id)) sh.deleteRow(i + 1);
}

function ordner_(eltern, name) {
  var it = eltern.getFoldersByName(name);
  return it.hasNext() ? it.next() : eltern.createFolder(name);
}

function jetzt_() { return Utilities.formatDate(new Date(), APP.zeitzone, 'yyyy-MM-dd HH:mm:ss'); }
function heute_() { return Utilities.formatDate(new Date(), APP.zeitzone, 'yyyy-MM-dd'); }
function isoDatum_(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function deDatum_(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4); }

/* ============================ Einrichtung ============================ */

/**
 * EINMAL AUSFÜHREN: legt die Tabellenblätter an und erstellt die zwei Zugänge.
 * Start-PINs:  Admin 1970  ·  Ahmet 2580  →  danach in der App unter "Team" ändern!
 */
function einrichten() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALZ')) props.setProperty('SALZ', Utilities.getUuid());
  var ss = db_();
  Object.keys(T).forEach(function (k) {
    var t = T[k];
    var sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(t.kopf.length, 1)).setNumberFormat('@');
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, t.kopf.length).setValues([t.kopf]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  var leer = ss.getSheetByName('Tabellenblatt1') || ss.getSheetByName('Sheet1');
  if (leer && ss.getSheets().length > 1 && leer.getLastRow() === 0) ss.deleteSheet(leer);
  if (zeilen_(T.MA).length === 0) {
    schreiben_(T.MA, { id: 'admin', name: 'D. Söner', pinHash: hash_('1970'), rolle: 'admin', sprache: 'de', aktiv: 'ja' });
    schreiben_(T.MA, { id: 'ahmet', name: 'Ahmed Sürer', pinHash: hash_('2580'), rolle: 'mitarbeiter', sprache: 'tr', aktiv: 'ja' });
  }
  ordner_(DriveApp.getRootFolder(), APP.ordner);
  Logger.log('Fertig. Jetzt: Bereitstellen → Neue Bereitstellung → Web-App.');
}

function belegeLesen_(v) { try { var b = v ? JSON.parse(v) : []; return Array.isArray(b) ? b : []; } catch (x) { return []; } }

/** Im Editor ausführen: misst, wie schnell die KI-Modelle antworten. */
function kiTesten() { kiDiagnose_({}).forEach(function (z) { console.log(z); }); }

/* ============================ Abrechnung je Baustelle ============================ */

function abrechnung_(d) {
  var bs = finde_(T.BS, String(d.baustelle || ''));
  if (!bs) throw new Error('Baustelle wählen');
  var von = String(d.von || ''), bis = String(d.bis || '');
  pruefeDatum_(von); pruefeDatum_(bis);
  var namen = {}; zeilen_(T.MA).forEach(function (m) { namen[m.id] = m.name; });
  var es = zeilen_(T.E).filter(function (e) { return e.typ === 'A' && e.baustelle === bs.id && e.datum >= von && e.datum <= bis; })
    .map(eintragAus_).sort(function (a, b) { return (a.datum + a.start) < (b.datum + b.start) ? -1 : 1; });
  var pers = {}, mat = {}, km = 0, belege = [], tage = [], offen = 0;
  es.forEach(function (e) {
    var h = stunden_(e); if (!e.ende) offen++;
    var p = pers[e.ma] || (pers[e.ma] = { id: e.ma, name: namen[e.ma] || e.ma, stunden: 0, tage: {} });
    p.stunden += h; p.tage[e.datum] = 1;
    km += Number(e.km || 0);
    (e.material || []).forEach(function (m) {
      var k = String(m.text).trim().toLowerCase() + '|' + (m.einheit || '');
      var z = mat[k] || (mat[k] = { text: String(m.text).trim(), einheit: m.einheit || '', menge: 0, ek: 0, ohnePreis: false });
      var n = Number(String(m.menge || '').replace(',', '.')); z.menge += isNaN(n) ? 0 : n;
      if (m.preis != null && m.preis !== '') z.ek += Number(m.preis); else z.ohnePreis = true;
    });
    (e.belege || []).forEach(function (b) { belege.push({ id: b.id, name: b.name, datum: e.datum }); });
    tage.push({ datum: e.datum, ma: namen[e.ma] || e.ma, start: e.start, ende: e.ende || '', std: Math.round(h * 100) / 100, taetigkeit: e.taetigkeit || '' });
  });
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  return {
    baustelle: { id: bs.id, name: bs.name, adresse: bs.adresse || '' }, von: von, bis: bis, offen: offen,
    personen: Object.keys(pers).map(function (k) { var p = pers[k]; return { id: p.id, name: p.name, stunden: r2(p.stunden), tage: Object.keys(p.tage).length }; }),
    material: Object.keys(mat).map(function (k) { var z = mat[k]; z.menge = r2(z.menge); z.ek = r2(z.ek); return z; })
      .sort(function (a, b) { return a.text.localeCompare(b.text, 'de'); }),
    km: r2(km), belege: belege, tage: tage
  };
}

function abrechnungTabelle_(d) {
  var a = abrechnung_(d), satz = d.saetze || {}, auf = Number(d.aufschlag || 0) / 100;
  var titel = a.baustelle.name + ' vorläufige Rechnung ' + deDatum_(a.von) + ' – ' + deDatum_(a.bis);
  var ss = SpreadsheetApp.create(titel), sh = ss.getSheets()[0];
  sh.setName('Abrechnung');
  var z = [];
  z.push(['Abrechnungsübersicht (intern) – ' + APP.firma, '', '', '', '', '']);
  z.push(['Baustelle', a.baustelle.name + (a.baustelle.adresse ? ', ' + a.baustelle.adresse : ''), '', '', '', '']);
  z.push(['Zeitraum', deDatum_(a.von) + ' – ' + deDatum_(a.bis), '', '', '', '']);
  z.push(['', '', '', '', '', '']);
  z.push(['ARBEITSZEIT', 'Stunden', 'Tage', '€/Std. netto', 'Summe netto', '']);
  var lohnStart = z.length + 1;
  a.personen.forEach(function (p) { var r = z.length + 1; z.push([p.name, p.stunden, p.tage, Number(satz[p.id] || 0), '=B' + r + '*D' + r, '']); });
  var lohnEnde = z.length;
  z.push(['Summe Arbeitszeit', '', '', '', a.personen.length ? '=SUM(E' + lohnStart + ':E' + lohnEnde + ')' : 0, '']);
  var lohnSumme = z.length;
  z.push(['', '', '', '', '', '']);
  z.push(['MATERIAL', 'Menge', 'Einheit', 'EK gesamt', 'VK netto (+' + Math.round(auf * 100) + ' %)', 'Hinweis']);
  var matStart = z.length + 1;
  a.material.forEach(function (m) { var r = z.length + 1; z.push([m.text, m.menge, m.einheit, m.ek || '', '=D' + r + '*' + (1 + auf), m.ohnePreis ? 'Preis fehlt' : '']); });
  var matEnde = z.length;
  z.push(['Summe Material', '', '', a.material.length ? '=SUM(D' + matStart + ':D' + matEnde + ')' : 0, a.material.length ? '=SUM(E' + matStart + ':E' + matEnde + ')' : 0, '']);
  var matSumme = z.length;
  z.push(['', '', '', '', '', '']);
  z.push(['GESAMT NETTO', '', '', '', '=E' + lohnSumme + '+E' + matSumme, '']);
  z.push(['Gefahrene km', a.km, '', '', '', '']);
  z.push(['', '', '', '', '', '']);
  z.push(['TAGE', 'Mitarbeiter', 'Zeit', 'Std.', 'Tätigkeit', '']);
  a.tage.forEach(function (t) { z.push([deDatum_(t.datum), t.ma, t.start + '–' + (t.ende || '…'), t.std, t.taetigkeit, '']); });
  if (a.belege.length) {
    z.push(['', '', '', '', '', '']); z.push(['BELEGE', '', '', '', '', '']);
    a.belege.forEach(function (b) { z.push([deDatum_(b.datum), b.name, '', '', 'https://drive.google.com/file/d/' + b.id + '/view', '']); });
  }
  sh.getRange(1, 1, z.length, 6).setValues(z);
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  [5, matStart - 1, lohnSumme, matSumme, matSumme + 2].forEach(function (r) { sh.getRange(r, 1, 1, 6).setFontWeight('bold'); });
  sh.getRange(lohnStart, 4, Math.max(1, lohnSumme - lohnStart + 1), 2).setNumberFormat('#,##0.00 €');
  sh.getRange(matStart, 4, Math.max(1, matSumme - matStart + 1), 2).setNumberFormat('#,##0.00 €');
  sh.getRange(matSumme + 2, 5).setNumberFormat('#,##0.00 €');
  sh.setColumnWidth(1, 260); sh.setColumnWidth(5, 280);
  // Ablage: Rechn.-Angebot › <Jahr> › <Baustelle> vorläufige Rechnung
  var basis; try { basis = DriveApp.getFolderById(APP.rechnungsOrdnerId); } catch (x) { basis = ordner_(ordner_(DriveApp.getRootFolder(), APP.ordner), 'Abrechnungen'); }
  var ziel = ordner_(ordner_(basis, a.bis.slice(0, 4)), (a.baustelle.name + ' vorläufige Rechnung').replace(/[\\\/]/g, '-'));
  // ältere Fassung mit gleichem Namen löschen (keine doppelten Dateien)
  var alt = ziel.getFilesByName(titel); while (alt.hasNext()) alt.next().setTrashed(true);
  var f = DriveApp.getFileById(ss.getId()); f.moveTo(ziel);
  return { url: ss.getUrl(), ordner: ziel.getUrl() };
}

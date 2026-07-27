/*!
 * msg-preview.js — бібліотека для парсингу та прев'ю Outlook .msg файлів у браузері.
 * Без залежностей. Ліцензія: MIT.
 *
 * API:
 *   MsgPreview.parse(arrayBuffer)            -> об'єкт із даними листа
 *   MsgPreview.render(bufferOrMsg, element, options) -> DOM-прев'ю
 *
 * Об'єкт листа:
 *   { subject, senderName, senderEmail, date, recipients: [{name, email, type}],
 *     bodyText, bodyHtml, bodyRtf, headers, attachments: [{name, mime, contentId, data, embedded}] }
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else global.MsgPreview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================ CFB (Compound File Binary) ============================ */

  var ENDOFCHAIN = 0xFFFFFFFE;
  var FREESECT = 0xFFFFFFFF;
  var NOSTREAM = 0xFFFFFFFF;

  function CFB(buf) {
    this.bytes = new Uint8Array(buf);
    this.dv = new DataView(buf);
    this._parseHeader();
    this._readFAT();
    this._readDirectory();
    this._readMiniFAT();
  }

  CFB.prototype._parseHeader = function () {
    var dv = this.dv;
    if (this.bytes.length < 512 ||
        dv.getUint32(0, true) !== 0xE011CFD0 || dv.getUint32(4, true) !== 0xE11AB1A1) {
      throw new Error('Це не файл формату .msg (немає сигнатури OLE Compound File)');
    }
    this.sectorShift = dv.getUint16(30, true);
    this.sectorSize = 1 << this.sectorShift;          // зазвичай 512
    this.miniSectorSize = 1 << dv.getUint16(32, true); // зазвичай 64
    this.numFatSectors = dv.getUint32(44, true);
    this.firstDirSector = dv.getUint32(48, true);
    this.miniStreamCutoff = dv.getUint32(56, true);    // зазвичай 4096
    this.firstMiniFatSector = dv.getUint32(60, true);
    this.numMiniFatSectors = dv.getUint32(64, true);
    this.firstDifatSector = dv.getUint32(68, true);
    this.numDifatSectors = dv.getUint32(72, true);
    this.maxSector = Math.ceil(this.bytes.length / this.sectorSize);
  };

  CFB.prototype._sectorOffset = function (sector) {
    return (sector + 1) * this.sectorSize;
  };

  CFB.prototype._readFAT = function () {
    var dv = this.dv, ss = this.sectorSize, perSector = ss / 4;
    // DIFAT: перші 109 записів у заголовку + ланцюжок DIFAT-секторів
    var difat = [];
    for (var i = 0; i < 109; i++) {
      var v = dv.getUint32(76 + i * 4, true);
      if (v !== FREESECT) difat.push(v);
    }
    var s = this.firstDifatSector, guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && guard++ <= this.numDifatSectors) {
      var off = this._sectorOffset(s);
      for (var j = 0; j < perSector - 1; j++) {
        var w = dv.getUint32(off + j * 4, true);
        if (w !== FREESECT) difat.push(w);
      }
      s = dv.getUint32(off + ss - 4, true);
    }
    // FAT — таблиця розміщення секторів
    var fat = new Uint32Array(difat.length * perSector);
    for (var k = 0; k < difat.length; k++) {
      var so = this._sectorOffset(difat[k]);
      for (var m = 0; m < perSector; m++) fat[k * perSector + m] = dv.getUint32(so + m * 4, true);
    }
    this.fat = fat;
  };

  CFB.prototype._chain = function (start, table) {
    var out = [], s = start, guard = 0, limit = table.length + 2;
    while (s !== ENDOFCHAIN && s !== FREESECT && s !== NOSTREAM) {
      if (guard++ > limit) throw new Error('Пошкоджений файл: цикл у FAT-ланцюжку');
      out.push(s);
      s = table[s];
      if (s === undefined) break;
    }
    return out;
  };

  CFB.prototype._readDirectory = function () {
    var chain = this._chain(this.firstDirSector, this.fat);
    var ss = this.sectorSize, dv = this.dv;
    var entries = [];
    for (var c = 0; c < chain.length; c++) {
      var base = this._sectorOffset(chain[c]);
      for (var e = 0; e < ss / 128; e++) {
        var off = base + e * 128;
        var nameLen = dv.getUint16(off + 64, true);
        var name = '';
        if (nameLen >= 2) {
          for (var i = 0; i < nameLen - 2; i += 2) name += String.fromCharCode(dv.getUint16(off + i, true));
        }
        entries.push({
          name: name,
          type: dv.getUint8(off + 66),          // 0=нема, 1=storage, 2=stream, 5=root
          left: dv.getUint32(off + 68, true),
          right: dv.getUint32(off + 72, true),
          child: dv.getUint32(off + 76, true),
          startSector: dv.getUint32(off + 116, true),
          size: dv.getUint32(off + 120, true) + dv.getUint32(off + 124, true) * 0x100000000
        });
      }
    }
    this.entries = entries;
    this.rootChain = this._chain(entries[0].startSector, this.fat); // mini-stream живе в root entry
  };

  CFB.prototype._readMiniFAT = function () {
    var chain = this._chain(this.firstMiniFatSector, this.fat);
    var ss = this.sectorSize, dv = this.dv;
    var mf = new Uint32Array(chain.length * (ss / 4));
    for (var c = 0; c < chain.length; c++) {
      var off = this._sectorOffset(chain[c]);
      for (var i = 0; i < ss / 4; i++) mf[c * (ss / 4) + i] = dv.getUint32(off + i * 4, true);
    }
    this.miniFat = mf;
  };

  CFB.prototype.readStream = function (entry) {
    var size = entry.size;
    var out = new Uint8Array(size);
    var pos = 0, i, off, n;
    if (entry === this.entries[0] || size >= this.miniStreamCutoff) {
      var chain = this._chain(entry.startSector, this.fat);
      for (i = 0; i < chain.length && pos < size; i++) {
        off = this._sectorOffset(chain[i]);
        n = Math.min(this.sectorSize, size - pos);
        out.set(this.bytes.subarray(off, off + n), pos);
        pos += n;
      }
    } else {
      var mchain = this._chain(entry.startSector, this.miniFat);
      for (i = 0; i < mchain.length && pos < size; i++) {
        var byteOff = mchain[i] * this.miniSectorSize;
        var sIdx = byteOff >> this.sectorShift;
        var within = byteOff & (this.sectorSize - 1);
        off = this._sectorOffset(this.rootChain[sIdx]) + within;
        n = Math.min(this.miniSectorSize, size - pos);
        out.set(this.bytes.subarray(off, off + n), pos);
        pos += n;
      }
    }
    return out;
  };

  // Дерево тек: у CFB діти зберігаються як червоно-чорне дерево через left/right
  CFB.prototype.children = function (entryIndex) {
    var result = [], entries = this.entries;
    var start = entries[entryIndex].child;
    if (start === NOSTREAM) return result;
    var stack = [start], seen = {};
    while (stack.length) {
      var id = stack.pop();
      if (id === NOSTREAM || id >= entries.length || seen[id]) continue;
      seen[id] = true;
      var en = entries[id];
      if (en.type !== 0) result.push({ index: id, entry: en });
      stack.push(en.left, en.right);
    }
    return result;
  };

  /* ============================ Декодування тексту ============================ */

  function codepageToLabel(cp) {
    if (!cp) return null;
    if (cp === 65001) return 'utf-8';
    if (cp === 65000) return 'utf-7';
    if (cp === 20127) return 'ascii';
    if (cp === 28591) return 'iso-8859-1';
    if (cp === 20866) return 'koi8-r';
    if (cp === 21866) return 'koi8-u';
    if (cp === 932) return 'shift_jis';
    if (cp === 936) return 'gbk';
    if (cp === 949) return 'euc-kr';
    if (cp === 950) return 'big5';
    if (cp >= 1250 && cp <= 1258) return 'windows-' + cp;
    if (cp >= 28592 && cp <= 28606) return 'iso-8859-' + (cp - 28590);
    return null;
  }

  function decodeBytes(bytes, label) {
    try { return new TextDecoder(label || 'windows-1252').decode(bytes); }
    catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }

  function decodeUtf16(bytes) {
    return new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '');
  }

  function filetimeToDate(lo, hi) {
    // FILETIME: 100-нс інтервали від 01.01.1601
    var ms = (hi * 4294967296 + lo) / 10000 - 11644473600000;
    return new Date(ms);
  }

  /* ============================ Декомпресія RTF (LZFu) ============================ */

  var LZFU_PREFILL =
    '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss ' +
    '\\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier' +
    '{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx';

  function decompressRTF(bytes) {
    if (bytes.length < 16) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var compSize = dv.getUint32(0, true);
    var rawSize = dv.getUint32(4, true);
    var magic = dv.getUint32(8, true);
    if (magic === 0x414C454D) return bytes.slice(16, 16 + rawSize); // "MELA" — без стиснення
    if (magic !== 0x75465A4C) return null;                          // не "LZFu"
    var dict = new Uint8Array(4096);
    for (var i = 0; i < LZFU_PREFILL.length; i++) dict[i] = LZFU_PREFILL.charCodeAt(i) & 0xFF;
    var wp = LZFU_PREFILL.length;
    var out = new Uint8Array(rawSize);
    var op = 0, pos = 16, end = Math.min(bytes.length, compSize + 4);
    while (pos < end && op < rawSize) {
      var control = bytes[pos++];
      for (var bit = 0; bit < 8 && pos < end && op < rawSize; bit++) {
        if (control & (1 << bit)) {
          if (pos + 1 >= end + 1) break;
          var b1 = bytes[pos++], b2 = bytes[pos++];
          var offset = (b1 << 4) | (b2 >> 4);
          var len = (b2 & 0x0F) + 2;
          if (offset === wp) { pos = end; break; } // маркер кінця
          for (var k = 0; k < len && op < rawSize; k++) {
            var ch = dict[offset]; offset = (offset + 1) & 4095;
            dict[wp] = ch; wp = (wp + 1) & 4095;
            out[op++] = ch;
          }
        } else {
          var c = bytes[pos++];
          dict[wp] = c; wp = (wp + 1) & 4095;
          out[op++] = c;
        }
      }
    }
    return out.subarray(0, op);
  }

  var CHARSET_TO_CP = { 0: 1252, 128: 932, 129: 949, 134: 936, 136: 950, 161: 1253, 162: 1254,
                        163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250 };

  function rtfFontCodepages(s, defaultLabel) {
    // Будуємо мапу: номер шрифту -> кодування (з \fcharset у таблиці шрифтів)
    var map = {}, re = /\\f(\d+)[\\a-z0-9\- ]*?\\fcharset(\d+)/g, m;
    while ((m = re.exec(s)) !== null) {
      var cp = CHARSET_TO_CP[parseInt(m[2], 10)];
      map[m[1]] = (cp && codepageToLabel(cp)) || defaultLabel;
    }
    return map;
  }

  // Деінкапсуляція HTML з RTF (\fromhtml1, за MS-OXRTFEX).
  // Outlook часто зберігає HTML-тіло лише у стисненому RTF.
  function rtfDeencapsulateHtml(rtfBytes) {
    var s = decodeBytes(rtfBytes, 'ascii');
    if (!/\\fromhtml/.test(s.slice(0, 400))) return null;
    var mcp = /\\ansicpg(\d+)/.exec(s.slice(0, 200));
    var defaultCp = (mcp && codepageToLabel(parseInt(mcp[1], 10))) || 'windows-1252';
    var fontCp = rtfFontCodepages(s, defaultCp);
    var curCp = defaultCp;
    var destSkip = { fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, generator: 1,
                     pntext: 1, themedata: 1, colorschememapping: 1 };
    var out = [], pending = [];
    var i = 0, n = s.length, depth = 0, suppress = false, htmltagDepth = 0, skipDepth = 0;
    function emitting() { return htmltagDepth > 0 || (!suppress && !skipDepth); }
    function flush() {
      if (pending.length) { out.push(decodeBytes(new Uint8Array(pending), curCp)); pending = []; }
    }
    while (i < n) {
      var c = s[i];
      if (c === '{') { depth++; i++; continue; }
      if (c === '}') {
        depth--;
        if (skipDepth && depth < skipDepth) skipDepth = 0;
        if (htmltagDepth && depth < htmltagDepth) { flush(); htmltagDepth = 0; }
        i++; continue;
      }
      if (c === '\\') {
        var c2 = s[i + 1];
        if (c2 === "'") {
          if (emitting()) pending.push(parseInt(s.substr(i + 2, 2), 16));
          i += 4; continue;
        }
        if (c2 === '\\' || c2 === '{' || c2 === '}') {
          if (emitting()) pending.push(c2.charCodeAt(0));
          i += 2; continue;
        }
        if (c2 === '~') { if (emitting()) { flush(); out.push('\u00A0'); } i += 2; continue; }
        if (c2 === '*') {
          var mt = /^\\\*\\htmltag(\d+)? ?/.exec(s.substr(i, 24));
          if (mt) { htmltagDepth = depth; i += mt[0].length; }
          else { skipDepth = depth; i += 2; }
          continue;
        }
        var m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.substr(i, 34));
        if (m) {
          i += m[0].length;
          var word = m[1], num = m[2] ? parseInt(m[2], 10) : null;
          if (destSkip[word] && !htmltagDepth) { skipDepth = depth; continue; }
          if (word === 'htmlrtf') { suppress = num !== 0; continue; }
          if (word === 'f' && num !== null) { flush(); curCp = fontCp[num] || defaultCp; continue; }
          if (!emitting()) continue;
          flush();
          if (word === 'par' || word === 'line') out.push('\r\n');
          else if (word === 'tab') out.push('\t');
          else if (word === 'u' && num !== null) {
            out.push(String.fromCharCode(num < 0 ? num + 65536 : num));
            if (s[i] === '?') i++;
          }
          continue;
        }
        i += 2; continue;
      }
      if (c !== '\r' && c !== '\n') { if (emitting()) pending.push(s.charCodeAt(i)); }
      i++;
    }
    flush();
    var html = out.join('');
    return /</.test(html) ? html : null;
  }

  // Спрощене перетворення RTF → текст (запасний варіант, якщо немає HTML/plain тіла)
  function rtfToText(rtfBytes, cpLabel) {
    var s = decodeBytes(rtfBytes, 'ascii');
    var out = [], i = 0, n = s.length;
    var skipGroups = { fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1,
                       generator: 1, themedata: 1, colorschememapping: 1, datastore: 1 };
    var skipDepth = 0, depth = 0;
    var pendingBytes = [];
    function flushBytes() {
      if (pendingBytes.length) {
        out.push(decodeBytes(new Uint8Array(pendingBytes), cpLabel));
        pendingBytes = [];
      }
    }
    while (i < n) {
      var c = s[i];
      if (c === '{') { depth++; i++; continue; }
      if (c === '}') { depth--; if (skipDepth && depth < skipDepth) skipDepth = 0; i++; continue; }
      if (c === '\\') {
        i++;
        var c2 = s[i];
        if (c2 === "'") { // \'hh — байт у кодуванні
          var hex = s.substr(i + 1, 2); i += 3;
          if (!skipDepth) pendingBytes.push(parseInt(hex, 16));
          continue;
        }
        if (c2 === '\\' || c2 === '{' || c2 === '}') { if (!skipDepth) { flushBytes(); out.push(c2); } i++; continue; }
        if (c2 === '*') { i++; continue; }
        if (c2 === '~') { if (!skipDepth) { flushBytes(); out.push('\u00A0'); } i++; continue; }
        var m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.substr(i, 32));
        if (m) {
          i += m[0].length;
          var word = m[1], num = m[2] ? parseInt(m[2], 10) : null;
          if (skipGroups[word]) { skipDepth = depth; continue; }
          if (skipDepth) continue;
          flushBytes();
          if (word === 'par' || word === 'line') out.push('\n');
          else if (word === 'tab') out.push('\t');
          else if (word === 'u' && num !== null) {
            out.push(String.fromCharCode(num < 0 ? num + 65536 : num));
            if (s[i] === '?') i++; // пропускаємо запасний символ
          }
          continue;
        }
        i++;
        continue;
      }
      if (!skipDepth && c !== '\r' && c !== '\n') pendingBytes.push(s.charCodeAt(i));
      i++;
    }
    flushBytes();
    return out.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ============================ Витяг MAPI-властивостей ============================ */

  function readSubStorageProps(cfb, entryIndex) {
    // Повертає {props: {id -> {type, bytes|value}}, children: [{name, index}]}
    var props = {}, subStorages = [];
    var kids = cfb.children(entryIndex);
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i], name = k.entry.name;
      if (name.indexOf('__substg1.0_') === 0 && k.entry.type === 2) {
        var tag = name.substr(12, 8).toUpperCase();
        var id = tag.substr(0, 4), type = tag.substr(4, 4);
        props[id] = { type: type, bytes: cfb.readStream(k.entry) };
      } else if (name.indexOf('__substg1.0_') === 0 && k.entry.type === 1) {
        // вкладений storage (наприклад, вкладений лист у 3701000D)
        var tag2 = name.substr(12, 8).toUpperCase();
        props[tag2.substr(0, 4)] = { type: tag2.substr(4, 4), storageIndex: k.index };
      } else if (name === '__properties_version1.0') {
        props.__fixed = cfb.readStream(k.entry);
      } else if (k.entry.type === 1) {
        subStorages.push({ name: name, index: k.index });
      }
    }
    return { props: props, subStorages: subStorages };
  }

  function parseFixedProps(bytes, headerSize, props) {
    if (!bytes || bytes.length < headerSize) return;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (var off = headerSize; off + 16 <= bytes.length; off += 16) {
      var type = dv.getUint16(off, true);
      var id = dv.getUint16(off + 2, true).toString(16).toUpperCase().padStart(4, '0');
      if (props[id]) continue; // substream має пріоритет
      var value = null;
      switch (type) {
        case 0x0002: value = dv.getInt16(off + 8, true); break;
        case 0x0003: value = dv.getInt32(off + 8, true); break;
        case 0x000B: value = dv.getUint8(off + 8) !== 0; break;
        case 0x0005: value = dv.getFloat64(off + 8, true); break;
        case 0x0014: value = Number(dv.getBigInt64(off + 8, true)); break;
        case 0x0040: value = filetimeToDate(dv.getUint32(off + 8, true), dv.getUint32(off + 12, true)); break;
        default: continue; // змінні типи тут містять лише розмір
      }
      props[id] = { type: type.toString(16).padStart(4, '0').toUpperCase(), value: value };
    }
  }

  function makeGetter(props, cpLabel) {
    return function get(id) {
      var p = props[id];
      if (!p) return null;
      if ('value' in p) return p.value;
      if (!p.bytes) return null;
      if (p.type === '001F') return decodeUtf16(p.bytes);
      if (p.type === '001E') return decodeBytes(p.bytes, cpLabel).replace(/\0+$/, '');
      return p.bytes; // 0102 та інші — сирі байти
    };
  }

  function detectCodepage(props) {
    var p = props['3FFD'];
    var cp = p && 'value' in p ? p.value : null;
    if (!cp) {
      var q = props['3FDE'];
      cp = q && 'value' in q ? q.value : null;
      // ISO-2022-* інтернет-кодування → відповідні ANSI-кодові сторінки для рядків
      var iso2022 = { 50220: 932, 50221: 932, 50222: 932, 50225: 949, 50227: 936, 52936: 936 };
      if (cp && iso2022[cp]) cp = iso2022[cp];
    }
    return codepageToLabel(cp);
  }

  function decodeHtmlBody(bytes, props, htmlCpLabel) {
    // Кодування HTML: PidTagInternetCodepage (3FDE) або charset у самому HTML
    var head = decodeBytes(bytes.subarray(0, Math.min(bytes.length, 2048)), 'ascii');
    var m = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
    var label = (m && m[1].toLowerCase()) || htmlCpLabel || 'utf-8';
    return decodeBytes(bytes, label);
  }

  function parseStorageAsMessage(cfb, entryIndex, isTopLevel) {
    var st = readSubStorageProps(cfb, entryIndex);
    var props = st.props;
    parseFixedProps(props.__fixed, isTopLevel ? 32 : 24, props);
    var cpLabel = detectCodepage(props);
    var get = makeGetter(props, cpLabel);

    var msg = {
      subject: get('0037') || get('0E1D') || '',
      senderName: get('5D02') || get('0C1A') || get('0042') || '',
      senderEmail: get('5D01') || get('5D0A') || null,
      date: get('0E06') || get('0039') || null,
      headers: get('007D') || null,
      recipients: [],
      attachments: [],
      bodyText: get('1000') || null,
      bodyHtml: null,
      bodyRtf: null
    };

    // Адреса відправника: SMTP → або з поля 0C1F, якщо воно схоже на email
    if (!msg.senderEmail) {
      var addr = get('0C1F') || get('0065');
      if (addr && addr.indexOf('@') > 0) msg.senderEmail = addr;
    }

    // HTML-тіло
    var htmlProp = props['1013'];
    if (htmlProp && htmlProp.bytes) {
      var htmlCp = codepageToLabel(props['3FDE'] && props['3FDE'].value) || cpLabel;
      msg.bodyHtml = decodeHtmlBody(htmlProp.bytes, props, htmlCp);
    } else if (htmlProp && htmlProp.type === '001F') {
      msg.bodyHtml = get('1013');
    }

    // RTF-тіло (стиснене)
    var rtfProp = props['1009'];
    if (rtfProp && rtfProp.bytes) {
      var rtf = decompressRTF(rtfProp.bytes);
      if (rtf) {
        msg.bodyRtf = rtf;
        if (!msg.bodyHtml) {
          try { msg.bodyHtml = rtfDeencapsulateHtml(rtf); } catch (e) { /* ігноруємо */ }
        }
        if (!msg.bodyText && !msg.bodyHtml) {
          try { msg.bodyText = rtfToText(rtf, cpLabel); } catch (e) { /* ігноруємо */ }
        }
      }
    }

    // Одержувачі та вкладення
    for (var i = 0; i < st.subStorages.length; i++) {
      var sub = st.subStorages[i], name = sub.name;
      if (name.indexOf('__recip_version1.0_') === 0) {
        var r = readSubStorageProps(cfb, sub.index);
        parseFixedProps(r.props.__fixed, 8, r.props);
        var rg = makeGetter(r.props, cpLabel);
        var rtype = rg('0C15'); // 1=To, 2=Cc, 3=Bcc
        var smtp = rg('39FE') || rg('3003');
        msg.recipients.push({
          name: rg('3001') || '',
          email: smtp && smtp.indexOf && smtp.indexOf('@') > 0 ? smtp : null,
          type: rtype === 2 ? 'cc' : rtype === 3 ? 'bcc' : 'to'
        });
      } else if (name.indexOf('__attach_version1.0_') === 0) {
        var a = readSubStorageProps(cfb, sub.index);
        parseFixedProps(a.props.__fixed, 8, a.props);
        var ag = makeGetter(a.props, cpLabel);
        var dataProp = a.props['3701'];
        var att = {
          name: ag('3707') || ag('3704') || ag('3001') || 'вкладення',
          mime: ag('370E') || null,
          contentId: ag('3712') || null,
          hidden: ag('7FFE') === true,
          data: null,
          embedded: null
        };
        if (dataProp) {
          if (dataProp.bytes) att.data = dataProp.bytes;
          else if (dataProp.storageIndex !== undefined && dataProp.type === '000D') {
            // вкладений .msg
            try {
              att.embedded = parseStorageAsMessage(cfb, dataProp.storageIndex, false);
              att.name = ag('3001') || att.embedded.subject || 'вкладене повідомлення';
            } catch (e) { /* ігноруємо */ }
          }
        }
        msg.attachments.push(att);
      }
    }

    // Сортуємо одержувачів: to, cc, bcc
    var order = { to: 0, cc: 1, bcc: 2 };
    msg.recipients.sort(function (x, y) { return order[x.type] - order[y.type]; });
    return msg;
  }

  function parse(arrayBuffer) {
    if (arrayBuffer instanceof Uint8Array) {
      arrayBuffer = arrayBuffer.buffer.slice(arrayBuffer.byteOffset, arrayBuffer.byteOffset + arrayBuffer.byteLength);
    }
    var cfb = new CFB(arrayBuffer);
    return parseStorageAsMessage(cfb, 0, true);
  }

  /* ============================ Рендер прев'ю ============================ */

  var CSS = [
    '.msgp{font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2733;',
    'border:1px solid #d7dde6;border-radius:10px;overflow:hidden;background:#fff}',
    '.msgp-head{padding:16px 20px;border-bottom:1px solid #e6ebf2;background:#f7f9fc}',
    '.msgp-subject{font-size:18px;font-weight:650;margin:0 0 10px}',
    '.msgp-row{display:flex;gap:8px;margin:2px 0;font-size:13px}',
    '.msgp-label{color:#69758a;min-width:44px;flex:none}',
    '.msgp-who b{font-weight:600}',
    '.msgp-who span{color:#69758a}',
    '.msgp-date{color:#69758a;font-size:12.5px;margin-top:6px}',
    '.msgp-body{padding:0}',
    '.msgp-body iframe{display:block;width:100%;border:0;min-height:80px}',
    '.msgp-body pre{margin:0;padding:16px 20px;white-space:pre-wrap;word-wrap:break-word;',
    'font:13.5px/1.55 -apple-system,"Segoe UI",Roboto,sans-serif}',
    '.msgp-atts{display:flex;flex-wrap:wrap;gap:8px;padding:12px 20px;border-top:1px solid #e6ebf2;background:#fafbfd}',
    '.msgp-att{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #d7dde6;',
    'border-radius:999px;font-size:12.5px;color:#1f2733;text-decoration:none;background:#fff}',
    'a.msgp-att:hover{border-color:#8fa3c4;background:#f2f6fd}',
    '.msgp-att .msgp-size{color:#69758a}',
    '.msgp-empty{padding:20px;color:#69758a;font-style:italic}'
  ].join('');

  var cssInjected = false;
  function injectCSS(doc) {
    if (cssInjected) return;
    var st = doc.createElement('style');
    st.textContent = CSS;
    doc.head.appendChild(st);
    cssInjected = true;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' Б';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ';
    return (n / 1048576).toFixed(1) + ' МБ';
  }

  function fmtWho(name, email) {
    var h = '';
    if (name) h += '<b>' + esc(name) + '</b>';
    if (email && email !== name) h += (h ? ' ' : '') + '<span>&lt;' + esc(email) + '&gt;</span>';
    return h || '<span>—</span>';
  }

  function sanitizeHtml(html) {
    // Прибираємо скрипти/обробники — додатковий шар до sandbox-iframe
    var previous, current = String(html);
    do {
      previous = current;
      current = current
        .replace(/<script\b[\s\S]*?<\/script\b[^>]*>/gi, '')
        .replace(/(\s)on([a-z0-9_-]*)(\s*=)/gi, '$1data-on$2$3')
        .replace(/(<\w[^>]*\s(?:href|src)\s*=\s*["']?)\s*javascript:/gi, '$1blocked:');
    } while (current !== previous);
    return current;
  }

  function render(input, container, options) {
    options = options || {};
    var doc = container.ownerDocument;
    injectCSS(doc);
    var msg = (input instanceof ArrayBuffer || input instanceof Uint8Array) ? parse(input) : input;

    var root = doc.createElement('div');
    root.className = 'msgp';

    // --- шапка ---
    var head = doc.createElement('div');
    head.className = 'msgp-head';
    var rows = '<div class="msgp-subject">' + (esc(msg.subject) || '(без теми)') + '</div>';
    rows += '<div class="msgp-row"><span class="msgp-label">Від:</span><span class="msgp-who">' +
            fmtWho(msg.senderName, msg.senderEmail) + '</span></div>';
    var groups = { to: [], cc: [], bcc: [] };
    (msg.recipients || []).forEach(function (r) { groups[r.type].push(fmtWho(r.name, r.email)); });
    if (groups.to.length) rows += '<div class="msgp-row"><span class="msgp-label">Кому:</span><span class="msgp-who">' + groups.to.join(', ') + '</span></div>';
    if (groups.cc.length) rows += '<div class="msgp-row"><span class="msgp-label">Копія:</span><span class="msgp-who">' + groups.cc.join(', ') + '</span></div>';
    if (groups.bcc.length) rows += '<div class="msgp-row"><span class="msgp-label">Прих.:</span><span class="msgp-who">' + groups.bcc.join(', ') + '</span></div>';
    if (msg.date) {
      var d = msg.date;
      rows += '<div class="msgp-date">' + esc(
        (options.formatDate ? options.formatDate(d) : d.toLocaleString(options.locale || 'uk-UA'))
      ) + '</div>';
    }
    head.innerHTML = rows;
    root.appendChild(head);

    // --- тіло ---
    var blobUrls = [];
    var body = doc.createElement('div');
    body.className = 'msgp-body';
    if (msg.bodyHtml) {
      var html = sanitizeHtml(msg.bodyHtml);
      // Підставляємо inline-зображення (cid:) з вкладень
      (msg.attachments || []).forEach(function (a) {
        if (a.contentId && a.data) {
          var url = URL.createObjectURL(new Blob([a.data], { type: a.mime || 'application/octet-stream' }));
          blobUrls.push(url);
          var cid = a.contentId.replace(/^</, '').replace(/>$/, '');
          html = html.split('cid:' + cid).join(url);
        }
      });
      var iframe = doc.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-same-origin'); // скрипти заборонено
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.srcdoc = '<!doctype html><meta charset="utf-8"><base target="_blank">' +
        '<style>body{margin:16px 20px;font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2733;word-wrap:break-word}</style>' + html;
      iframe.addEventListener('load', function () {
        try { iframe.style.height = (iframe.contentDocument.documentElement.scrollHeight + 8) + 'px'; } catch (e) {}
      });
      body.appendChild(iframe);
    } else if (msg.bodyText) {
      var pre = doc.createElement('pre');
      pre.textContent = msg.bodyText;
      body.appendChild(pre);
    } else {
      var empty = doc.createElement('div');
      empty.className = 'msgp-empty';
      empty.textContent = 'Лист не містить тексту.';
      body.appendChild(empty);
    }
    root.appendChild(body);

    // --- вкладення ---
    var visible = (msg.attachments || []).filter(function (a) { return !a.hidden || options.showHiddenAttachments; });
    if (visible.length) {
      var atts = doc.createElement('div');
      atts.className = 'msgp-atts';
      visible.forEach(function (a) {
        var el;
        if (a.data) {
          el = doc.createElement('a');
          var url = URL.createObjectURL(new Blob([a.data], { type: a.mime || 'application/octet-stream' }));
          blobUrls.push(url);
          el.href = url;
          el.download = a.name;
        } else {
          el = doc.createElement('span');
        }
        el.className = 'msgp-att';
        el.innerHTML = '📎 ' + esc(a.name) +
          (a.data ? ' <span class="msgp-size">' + fmtSize(a.data.length) + '</span>' : '') +
          (a.embedded ? ' <span class="msgp-size">(вкладений лист)</span>' : '');
        atts.appendChild(el);
      });
      root.appendChild(atts);
    }

    container.appendChild(root);
    return {
      element: root,
      message: msg,
      destroy: function () {
        blobUrls.forEach(function (u) { URL.revokeObjectURL(u); });
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  return { parse: parse, render: render, decompressRTF: decompressRTF, version: '1.0.0' };
});

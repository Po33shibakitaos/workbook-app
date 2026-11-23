/*
 * 小さな Word(.docx) 生成器。外部ライブラリなし・通信なし。
 * docx は「XML ファイルを zip にまとめたもの」なので、XML を文字列で作り、無圧縮 zip に詰めている。
 *
 * 使い方:
 *   const bytes = Docx.build({ blocks: [...], font: '...', size: 26, titlePage: true });
 *   blocks の要素（段落）:
 *     { runs: [{ t: '文字（\t でタブ）', b: true, u: true, sz: 40 }],
 *       align: 'left'|'center'|'right', before: 0, after: 120, line: 320,
 *       keepNext: true, keepLines: true, pageBreakBefore: true,
 *       tabs: [{ pos: 567, val: 'left'|'right', leader: 'underscore'|'dot' }],
 *       left: 567, hanging: 567 }
 *   長さの単位は twip（1mm ≒ 56.7）。文字サイズ sz は半ポイント（13pt = 26）。
 */
(function () {
  'use strict';

  // ---------- zip（無圧縮） ----------
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const locals = [];
    const centrals = [];
    let offset = 0;

    files.forEach(function (f) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true); // UTF-8 のファイル名
      lh.setUint16(8, 0, true);      // 無圧縮
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      locals.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true);
      ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true);
      ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true);
      ch.setUint32(42, offset, true);
      centrals.push(new Uint8Array(ch.buffer), name);

      offset += 30 + name.length + data.length;
    });

    const cdSize = centrals.reduce(function (s, a) { return s + a.length; }, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);

    const parts = locals.concat(centrals, [new Uint8Array(end.buffer)]);
    const total = parts.reduce(function (s, a) { return s + a.length; }, 0);
    const out = new Uint8Array(total);
    let p = 0;
    parts.forEach(function (a) { out.set(a, p); p += a.length; });
    return out;
  }

  // ---------- XML ----------
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      // XML で使えない制御文字を除く
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  function runXml(r) {
    let rpr = '';
    if (r.b) rpr += '<w:b/><w:bCs/>';
    if (r.color) rpr += '<w:color w:val="' + r.color + '"/>';
    if (r.sz) rpr += '<w:sz w:val="' + r.sz + '"/><w:szCs w:val="' + r.sz + '"/>';
    if (r.u) rpr += '<w:u w:val="single"/>';
    const body = String(r.t).split('\t').map(function (piece) {
      return piece ? '<w:t xml:space="preserve">' + esc(piece) + '</w:t>' : '';
    }).join('<w:tab/>');
    return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + body + '</w:r>';
  }

  function paraXml(p) {
    let ppr = '';
    if (p.keepNext) ppr += '<w:keepNext/>';
    if (p.keepLines !== false) ppr += '<w:keepLines/>'; // 1つの段落はページをまたがせない
    if (p.pageBreakBefore) ppr += '<w:pageBreakBefore/>';
    if (p.tabs && p.tabs.length) {
      ppr += '<w:tabs>' + p.tabs.map(function (t) {
        return '<w:tab w:val="' + (t.val || 'left') + '"' + (t.leader ? ' w:leader="' + t.leader + '"' : '') + ' w:pos="' + t.pos + '"/>';
      }).join('') + '</w:tabs>';
    }
    if (p.before != null || p.after != null || p.line != null) {
      ppr += '<w:spacing' +
        (p.before != null ? ' w:before="' + p.before + '"' : '') +
        (p.after != null ? ' w:after="' + p.after + '"' : '') +
        (p.line != null ? ' w:line="' + p.line + '" w:lineRule="auto"' : '') + '/>';
    }
    if (p.left != null || p.hanging != null) {
      ppr += '<w:ind' + (p.left != null ? ' w:left="' + p.left + '"' : '') +
        (p.hanging != null ? ' w:hanging="' + p.hanging + '"' : '') + '/>';
    }
    if (p.align) ppr += '<w:jc w:val="' + (p.align === 'justify' ? 'both' : p.align) + '"/>';
    return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + (p.runs || []).map(runXml).join('') + '</w:p>';
  }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
             'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  function build(opt) {
    const font = esc(opt.font || 'HG丸ｺﾞｼｯｸM-PRO');
    const size = opt.size || 26;
    const titlePage = !!opt.titlePage;

    const sect =
      '<w:sectPr>' +
        '<w:footerReference w:type="default" r:id="rIdFooter"/>' +
        '<w:pgSz w:w="11906" w:h="16838"/>' + // A4 縦
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>' +
        (titlePage ? '<w:pgNumType w:start="0"/>' : '') + // 表紙の次のページを 1 にする
        '<w:cols w:space="425"/>' +
        (titlePage ? '<w:titlePg/>' : '') + // 表紙にはページ番号を出さない
        '<w:docGrid w:linePitch="360"/>' +
      '</w:sectPr>';

    const documentXml = HEAD + '<w:document ' + NS + '><w:body>' +
      opt.blocks.map(paraXml).join('') + sect + '</w:body></w:document>';

    const stylesXml = HEAD +
      '<w:styles ' + NS + '>' +
        '<w:docDefaults>' +
          '<w:rPrDefault><w:rPr>' +
            '<w:rFonts w:ascii="' + font + '" w:eastAsia="' + font + '" w:hAnsi="' + font + '" w:cs="' + font + '"/>' +
            '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' +
            '<w:lang w:val="en-US" w:eastAsia="ja-JP"/>' +
          '</w:rPr></w:rPrDefault>' +
          '<w:pPrDefault><w:pPr><w:snapToGrid w:val="0"/><w:spacing w:after="0" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
        '</w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '</w:styles>';

    const footerXml = HEAD + '<w:ftr ' + NS + '><w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">- </w:t></w:r>' +
      '<w:fldSimple w:instr=" PAGE "><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple>' +
      '<w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve"> -</w:t></w:r></w:p></w:ftr>';

    const settingsXml = HEAD + '<w:settings ' + NS + '>' +
      '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
      '</w:settings>';

    const contentTypes = HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>';

    const rootRels = HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>';

    const docRels = HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
        '<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
      '</Relationships>';

    const coreXml = HEAD +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:title>' + esc(opt.title || '') + '</dc:title>' +
        '<dc:creator>workbook-app</dc:creator>' +
      '</cp:coreProperties>';

    return zipStore([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'docProps/core.xml', data: coreXml },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/styles.xml', data: stylesXml },
      { name: 'word/settings.xml', data: settingsXml },
      { name: 'word/footer1.xml', data: footerXml },
      { name: 'word/_rels/document.xml.rels', data: docRels }
    ]);
  }

  window.Docx = { build: build, _zipStore: zipStore, _crc32: crc32 };
})();

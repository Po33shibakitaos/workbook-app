/*
 * Word と同じ段落データ（docx.js の blocks）から、A4 縦の紙面を画面に描く。
 * 長さは twip（1/20 pt）で受け取り、CSS の pt に直して描く。改ページは高さを測っておおよそ再現する。
 */
(function () {
  'use strict';

  const PAGE_H = 16838, MARGIN = 1134, CONTENT_W = 11906 - MARGIN * 2, CONTENT_H = PAGE_H - MARGIN * 2;
  const pt = function (tw) { return (tw / 20) + 'pt'; };
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function runHtml(r) {
    const st = [];
    if (r.b) st.push('font-weight:bold');
    if (r.u) st.push('text-decoration:underline');
    if (r.sz) st.push('font-size:' + (r.sz / 2) + 'pt');
    const t = esc(r.t);
    return st.length ? '<span style="' + st.join(';') + '">' + t + '</span>' : t;
  }

  // runs を \t で区切って「区間」の配列にする
  function segments(runs) {
    const out = [[]];
    (runs || []).forEach(function (r) {
      String(r.t).split('\t').forEach(function (piece, i) {
        if (i > 0) out.push([]);
        if (piece) out[out.length - 1].push(Object.assign({}, r, { t: piece }));
      });
    });
    return out;
  }
  const segHtml = function (seg) { return seg.map(runHtml).join(''); };

  function paraEl(p) {
    const el = document.createElement('div');
    el.className = 'pv-p';
    const st = el.style;
    st.paddingTop = pt(p.before || 0);
    st.paddingBottom = pt(p.after || 0);
    st.paddingLeft = pt(p.left || 0);
    st.lineHeight = String(((p.line || 300) / 240) * 1.25);
    if (p.align) st.textAlign = p.align === 'justify' ? 'justify' : p.align;

    const segs = segments(p.runs);
    if (segs.length === 1) {
      if (p.hanging) st.textIndent = '-' + pt(p.hanging);
      el.innerHTML = segHtml(segs[0]) || '&#8203;';
      return el;
    }

    // タブあり：横に並べる。1行目は (left - hanging) から始まる
    el.classList.add('tabbed');
    st.marginLeft = '-' + pt(p.hanging || 0);
    let cursor = (p.left || 0) - (p.hanging || 0);
    const tabs = p.tabs || [];
    let html = '';
    for (let k = 0; k < segs.length - 1; k++) {
      const tab = tabs[k] || { pos: cursor + 720 };
      const width = Math.max(0, tab.pos - cursor);
      const leader = tab.leader ? '<span class="pv-lead ' + (tab.leader === 'dot' ? 'dot' : 'line') + '"></span>' : '';
      if (tab.val === 'right') {
        html += '<span class="pv-seg">' + segHtml(segs[k]) + '</span>' + (leader || '<span class="pv-gap"></span>');
        cursor = CONTENT_W;
      } else {
        html += '<span class="pv-box" style="min-width:' + pt(width) + ';' + (leader ? 'width:' + pt(width) : '') + '">' +
          '<span class="pv-seg">' + segHtml(segs[k]) + '</span>' + leader + '</span>';
        cursor = tab.pos;
      }
    }
    const last = segHtml(segs[segs.length - 1]);
    if (last) html += '<span class="pv-last">' + last + '</span>'; // 空なら置かない（罫線を右端まで伸ばすため）
    el.innerHTML = html;
    return el;
  }

  function newPage(host) {
    const page = document.createElement('div');
    page.className = 'pv-page';
    const body = document.createElement('div');
    body.className = 'pv-body';
    page.appendChild(body);
    host.appendChild(page);
    return { page: page, body: body };
  }

  function render(outer, blocks, opt) {
    opt = opt || {};
    outer.innerHTML = '';
    const host = document.createElement('div'); // ページを入れる箱（縮小はこの箱だけにかける）
    outer.appendChild(host);

    // 1) 1枚のページに全部並べて、段落ごとの高さを測る
    const probe = newPage(host);
    const els = blocks.map(function (b) { const e = paraEl(b); probe.body.appendChild(e); return e; });
    const limit = probe.body.clientHeight; // 本文の高さ（px）
    const heights = els.map(function (e) { return e.offsetHeight; });
    host.innerHTML = '';

    // 2) keepNext でつながる段落はまとめて同じページへ
    const groups = [];
    let g = null;
    blocks.forEach(function (b, i) {
      if (!g || b.pageBreakBefore) { g = { items: [], h: 0, brk: !!b.pageBreakBefore }; groups.push(g); }
      g.items.push(i); g.h += heights[i];
      if (!b.keepNext) g = null;
    });

    let cur = newPage(host);
    let used = 0;
    const pages = [cur];
    groups.forEach(function (gr) {
      if ((gr.brk && used > 0) || (used > 0 && used + gr.h > limit)) {
        cur = newPage(host); pages.push(cur); used = 0;
      }
      gr.items.forEach(function (i) { cur.body.appendChild(els[i]); });
      used += gr.h;
    });

    // 3) ページ番号（表紙ありなら表紙には付けず、次のページを 1 にする）
    pages.forEach(function (pg, i) {
      const n = opt.titlePage ? i : i + 1;
      if (opt.titlePage && i === 0) return;
      const f = document.createElement('div');
      f.className = 'pv-foot';
      f.textContent = '- ' + n + ' -';
      pg.page.appendChild(f);
    });

    // 4) 画面が狭いときは縮小して表示
    const pageW = pages[0].page.offsetWidth;
    const avail = outer.clientWidth - 24;
    if (pageW > avail && avail > 0) host.style.zoom = String(avail / pageW);
    return pages.length;
  }

  window.Preview = { render: render };
})();

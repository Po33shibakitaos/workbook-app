/*
 * 英検ワークメーカー：画面の選択 → 問題の組み立て → Word（問題用・解答用）の出力。
 * データ：data/words.js（WB_WORDS）、data/sentences.js（WB_SENTENCES）、data/grammar.js（WB_GRAMMAR）。AI も通信も使わない。
 *
 * 単語ワーク：級を選び、単語の意味（記述式）と例文の穴埋めを出す。
 * 文法ワーク：級は選ばない。文法問題データ（WB_GRAMMAR）と、5〜3級の短文（WB_SENTENCES）から出す。
 *   形式は「選ぶ・埋める・並べる・書く」の4グループ。データに必要な項目がある問題だけがその形式に使われる。
 */
(function () {
  'use strict';

  const WORDS = window.WB_WORDS || [];
  const SENTS = window.WB_SENTENCES || [];
  const GITEMS = window.WB_GRAMMAR || [];
  const GRADES = ['5級', '4級', '3級', '準2級', '準2級プラス', '2級', '準1級', '1級'];
  const SENT_GRADES = ['5級', '4級', '3級']; // 文法ワークで使う短文の級（語彙を3級以下にするため）
  // 文法ボタン（中学校で習う順の目安）。関係副詞・仮定法は保留のため出さない。表記はデータのタグと必ず一致させる。
  const GRAMMAR_ORDER = ['be動詞', '一般動詞', '否定文', '疑問文', '三単現', '命令文', '前置詞', '現在進行形', '助動詞', '過去形',
    '過去進行形', '未来表現', 'There is構文', '接続詞', '不定詞', '動名詞', '比較', '最上級', '受動態', '5文型',
    '感嘆文', '現在完了形', '分詞', '関係代名詞', '間接疑問文', '付加疑問文', '分詞構文', '間接話法', '倒置・強調構文', 'その他'];
  // 文法ワークの形式（g はグループ）
  const GFORMS = [
    { v: 'choice', g: 'choose', label: '4択', title: '4択', guide: '日本語の意味に合うように、（　）に入る最も適切なものを選びなさい。' },
    { v: 'cloze', g: 'fill', label: '穴埋め', title: '穴埋め', guide: '日本語の意味に合うように、空所に適する英語を書きなさい。' },
    { v: 'inflect', g: 'fill', label: '語形変化', title: '語形変化', guide: '（　）内の語を、文に合う形にかえて書きなさい。' },
    { v: 'reorder', g: 'order', label: '並べ替え', title: '並べ替え', guide: '日本語の意味に合うように、（　）内の語句を並べ替えて英文を書きなさい。' },
    { v: 'trans', g: 'write', label: '和訳', title: '和訳', guide: '次の英文を日本語にしなさい。', guidePart: '英文の意味になるように、日本語の（　）に適する語句を書きなさい。' },
    { v: 'compose', g: 'write', label: '和文英訳', title: '和文英訳', guide: '次の日本語を英語にしなさい。' },
    { v: 'rewrite', g: 'write', label: '書き換え', title: '書き換え', guide: '次の英文を、（　）内の指示にしたがって書きかえなさい。' },
    { v: 'correct', g: 'write', label: '誤り訂正', title: '誤り訂正', guide: '次の英文には誤りが1か所あります。正しい英文に書き直しなさい。' },
    { v: 'answer', g: 'write', label: '応答', title: '応答', guide: '次の質問に、（　）内の日本語に合うように英語で答えなさい。' },
    { v: 'pattern', g: 'write', label: '文型を答える', title: '文型', guide: '次の英文は第何文型か答えなさい。' }
  ];
  const AUTO_ORDER = ['cloze', 'choice', 'inflect', 'reorder', 'rewrite', 'trans', 'correct', 'answer', 'pattern', 'compose'];
  const FONT = 'HG丸ｺﾞｼｯｸM-PRO';
  const STORE_KEY = 'wb-settings-v2';
  const REORDER_MIN = 4, REORDER_MAX = 12; // 英文全体の並べ替えに使う文の語数

  const $ = function (s) { return document.querySelector(s); };
  const $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function has(arr, v) { return arr.indexOf(v) >= 0; }

  // ---------- 補助 ----------
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sample(arr, n) { return shuffle(arr.slice()).slice(0, Math.max(0, n)); }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // 語として現れる位置（前後が英字でない）。大文字小文字は区別する。
  function findWord(text, w) {
    const m = new RegExp('(^|[^A-Za-z])(' + escRe(w) + ')(?![A-Za-z])').exec(text);
    return m ? m.index + m[1].length : -1;
  }

  // ---------- データの準備 ----------
  const wordsByGrade = {};
  GRADES.forEach(function (g) { wordsByGrade[g] = []; });
  WORDS.forEach(function (w, i) {
    if (w.type === 'word' && wordsByGrade[w.grade]) wordsByGrade[w.grade].push(Object.assign({ _i: i }, w));
  });

  // 文法ワークの問題（新しい文法問題データ → 5〜3級の短文 の順）
  const GPOOL = [];
  GITEMS.forEach(function (x, i) {
    const it = Object.assign({ src: 'g', _i: i, tags: [x.tag] }, x);
    it.blankAt = x.blank ? findWord(x.en, x.blank) : -1;
    if (x.blank && it.blankAt < 0) it.blankAt = x.en.indexOf(x.blank);
    GPOOL.push(it);
  });
  SENTS.forEach(function (x, i) {
    if (!has(SENT_GRADES, x.grade)) return;
    const ans = (x.blank_candidates || [])[0];
    const ok = ans && typeof x.blank_at === 'number' && x.en.substr(x.blank_at, ans.length) === ans;
    GPOOL.push({
      src: 's', _i: 100000 + i, id: x.id, tag: x.grammar_main, tags: [x.grammar_main].concat(x.grammar_sub || []),
      en: x.en, ja: x.ja, blank: ok ? ans : '', blankAt: ok ? x.blank_at : -1, choices: x.distractors || []
    });
  });

  // 並べ替え：語に区切る。文末の . ? ! は外して最後に付ける（先頭の語の大文字、I・固有名詞の大文字は元のまま）。
  function reorderParts(text) {
    text = text.trim();
    if (/(^|\s)[A-Z]:\s/.test(text) || /[—"“”:;()]/.test(text)) return null;
    const m = /^(.*?)([.?!])$/.exec(text);
    if (!m || /[.?!]\s/.test(m[1])) return null;
    const tokens = m[1].trim().split(/\s+/);
    if (tokens.length < REORDER_MIN || tokens.length > REORDER_MAX) return null;
    return { tokens: tokens, end: m[2] };
  }
  function scramble(tokens) {
    if (tokens.length < 2) return tokens.slice();
    let t;
    do { t = shuffle(tokens.slice()); } while (t.join(' ') === tokens.join(' '));
    return t;
  }

  // その問題がその形式に使えるか
  function usable(it, f, s) {
    switch (f) {
      case 'choice': return it.blankAt >= 0 && (it.choices || []).length === 3;
      case 'cloze': return it.blankAt >= 0;
      case 'inflect': return it.src === 'g' && it.blankAt >= 0 && !!it.base;
      case 'reorder':
        if (s.rtype === 'part') return it.src === 'g' && !!it.focus && it.focus.trim().split(/\s+/).length >= 2;
        return !!reorderParts(it.en);
      case 'trans': return s.ttype === 'part' ? (it.src === 'g' && !!it.ja_blank) : true;
      case 'compose': return true;
      case 'rewrite': return it.src === 'g' && !!(it.rewrite && it.rewrite.from);
      case 'correct': return it.src === 'g' && !!it.error;
      case 'answer': return it.src === 'g' && !!it.qa;
      case 'pattern': return it.src === 'g' && !!it.pattern;
    }
    return false;
  }
  // 文法の絞り込み。短文は、穴埋め・4択なら空所の文法、ほかの形式なら文中の文法でも見る。
  function grammarMatch(it, f, sel) {
    const mainOnly = (f !== 'reorder'); // 文中の文法で選ぶのは英文全体の並べ替えだけ
    if (it.src === 'g') return !sel.length || has(sel, it.tag);
    if ((f === 'trans' || f === 'compose') && (/(^|\s)[A-Z]:\s|—/.test(it.en) || /[.?!]\s+\S/.test(it.en))) return false; // 会話文・2文以上は和訳・英訳に使わない
    const tags = mainOnly ? [it.tag] : it.tags;
    if (!sel.length) return tags.some(function (t) { return t && t !== 'その他'; });
    return tags.some(function (t) { return has(sel, t); });
  }
  function poolFor(f, s) {
    const sel = s.grammars || [];
    return GPOOL.filter(function (it) { return grammarMatch(it, f, sel) && usable(it, f, s); });
  }

  // ---------- 画面の準備 ----------
  $('#grades').innerHTML = GRADES.map(function (g, i) {
    return '<label class="chip"><input type="radio" name="grade" value="' + g + '"' + (i === 0 ? ' checked' : '') + '><span>' + g + '</span></label>';
  }).join('');
  $('#grammarList').innerHTML = GRAMMAR_ORDER.map(function (g) {
    const label = g === 'その他' ? 'その他（語彙・熟語）' : g;
    return '<label class="chip"><input type="checkbox" name="grammar" value="' + g + '"><span>' + label + '<em class="gcount"></em></span></label>';
  }).join('');
  GFORMS.forEach(function (f) {
    const box = document.querySelector('#grammarForms .chips[data-group="' + f.g + '"]');
    box.insertAdjacentHTML('beforeend', '<label class="chip"><input type="checkbox" name="gform" value="' + f.v + '"><span>' + f.label + '<em class="gcount"></em></span></label>');
  });

  function readSettings() {
    const v = function (name) { const el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : null; };
    const vs = function (name) { return $$('input[name="' + name + '"]:checked').map(function (e) { return e.value; }); };
    return {
      mode: v('mode'),
      grade: v('grade'),
      grammars: vs('grammar'),
      forms: vs('form'),
      gforms: vs('gform'),
      rtype: v('rtype'),
      ttype: v('ttype'),
      dir: v('dir'),
      hint: v('hint'),
      count: parseInt($('#count').value, 10) || 0,
      order: 'random',   // 並び順はランダムで固定（2026-11-20 ユーザー指示。選ぶボタンは消した）
      titlePage: $('#titlePage').checked,
      explain: $('#explain').checked,
      title: $('#title').value.trim()
    };
  }

  function applySettings(s) {
    if (!s) return;
    const setRadio = function (name, val) { const el = document.querySelector('input[name="' + name + '"][value="' + val + '"]'); if (el) el.checked = true; };
    const setChecks = function (name, vals) { if (!Array.isArray(vals)) return; $$('input[name="' + name + '"]').forEach(function (e) { if (!e.disabled) e.checked = vals.indexOf(e.value) >= 0; }); };
    setRadio('mode', s.mode); setRadio('grade', s.grade); setChecks('form', s.forms);
    setChecks('grammar', s.grammars); setChecks('gform', s.gforms);
    setRadio('rtype', s.rtype); setRadio('ttype', s.ttype);
    setRadio('dir', s.dir); setRadio('hint', s.hint); setRadio('order', s.order);
    if (s.count) $('#count').value = s.count;
    if (typeof s.titlePage === 'boolean') $('#titlePage').checked = s.titlePage;
    if (typeof s.explain === 'boolean') $('#explain').checked = s.explain;
  }

  // 文法ボタン・形式ボタンに数を表示し、0 のものは選べなくする
  function updateChips() {
    const s = readSettings();
    $$('input[name="grammar"]').forEach(function (el) {
      const n = GPOOL.filter(function (it) { return it.tag === el.value; }).length; // 新しい文法問題＋空所の文法が一致する短文
      el.disabled = n === 0; if (n === 0) el.checked = false;
      el.parentNode.classList.toggle('off', n === 0);
      el.parentNode.querySelector('.gcount').textContent = String(n);
    });
    const s2 = readSettings();
    $$('input[name="gform"]').forEach(function (el) {
      const n = poolFor(el.value, s2).length;
      el.disabled = n === 0; if (n === 0) el.checked = false;
      el.parentNode.classList.toggle('off', n === 0);
      el.parentNode.querySelector('.gcount').textContent = String(n);
    });
    return s;
  }

  // ---------- 何問出せるか ----------
  function hasCloze(w) { return !!splitCloze(w); }
  function splitCloze(w) {
    if (!w.example_en || !w.example_ja) return null;
    const re = new RegExp('(^|[^A-Za-z])(' + escRe(w.en) + ')(?![A-Za-z])', 'i');
    const m = re.exec(w.example_en);
    if (!m) return null;
    const start = m.index + m[1].length;
    return { before: w.example_en.slice(0, start), answer: m[2], after: w.example_en.slice(start + m[2].length), ja: w.example_ja };
  }

  function planWord(s) {
    const words = wordsByGrade[s.grade] || [];
    const withEx = words.filter(hasCloze);
    const p = { words: words, withEx: withEx, wantMeaning: has(s.forms, 'meaning'), wantCloze: has(s.forms, 'cloze') };
    p.wordN = Math.min(s.count, p.wantMeaning ? words.length : withEx.length);
    p.meaningN = p.wantMeaning ? p.wordN : 0;
    p.clozeN = p.wantCloze ? Math.min(p.wordN, withEx.length) : 0;
    return p;
  }
  function planGrammar(s) {
    const out = {};
    s.gforms.forEach(function (f) { out[f] = Math.min(s.count, poolFor(f, s).length); });
    return out;
  }

  function refresh() {
    const s = updateChips();
    const g = s.mode === 'grammar';
    $('#gradeBox').classList.toggle('disabled', g);
    $('#gradeNote').hidden = !g;
    $('#grammarBox').hidden = !g;
    $('#wordForms').hidden = g;
    $('#grammarForms').hidden = !g;
    $('#explainBox').hidden = !g;
    $('#dirBox').classList.toggle('disabled', !has(s.forms, 'meaning'));
    const clozeOn = g ? has(s.gforms, 'cloze') : has(s.forms, 'cloze');
    $('#hintBox').classList.toggle('disabled', !clozeOn);
    $('#rtypeBox').classList.toggle('disabled', !has(s.gforms, 'reorder'));
    $('#ttypeBox').classList.toggle('disabled', !has(s.gforms, 'trans'));
    const hs = { none: 'She finally (　　　　　　) her dream.', initial: 'She finally (a________) her dream.', count: 'She finally a _ _ _ _ _ _ _ her dream.' };
    $('#hintSample').textContent = '例：' + hs[s.hint];

    const lines = [];
    if (g) {
      const p = planGrammar(s);
      const parts = GFORMS.filter(function (f) { return p[f.v]; }).map(function (f) { return f.label + ' ' + p[f.v] + '問'; });
      lines.push('文法：' + (s.grammars.length ? s.grammars.join('・') : 'すべて'));
      lines.push('→ ' + (parts.join('＋') || '形式を選んでください'));
    } else {
      const p = planWord(s);
      lines.push(s.grade + 'の単語：' + p.words.length + '語（穴埋め用の例文があるのは ' + p.withEx.length + '語）');
      const parts = [];
      if (p.meaningN) parts.push('単語の意味 ' + p.meaningN + '問');
      if (p.clozeN) parts.push('穴埋め ' + p.clozeN + '問');
      lines.push('→ ' + (parts.join('＋') || '形式を選んでください'));
    }
    $('#avail').textContent = lines.join('\n');
    $('#avail').style.whiteSpace = 'pre-line';
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 保存できなくても動く */ }
  }

  try { applySettings(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { /* 保存なしでも動く */ }
  document.addEventListener('change', refresh);
  $('#count').addEventListener('input', refresh);
  $$('.quick[data-n]').forEach(function (b) {
    b.addEventListener('click', function () { $('#count').value = b.dataset.n; refresh(); });
  });
  // おまかせ：選んだ文法で問題数の多い形式から順に、最大4種類
  $('#btnAuto').addEventListener('click', function () {
    const s = readSettings();
    const partOk = poolFor('reorder', Object.assign({}, s, { rtype: 'part' })).length >= 5;
    document.querySelector('input[name="rtype"][value="' + (partOk ? 'part' : 'full') + '"]').checked = true;
    const transPart = poolFor('trans', Object.assign({}, s, { ttype: 'part' })).length >= 5;
    document.querySelector('input[name="ttype"][value="' + (transPart ? 'part' : 'full') + '"]').checked = true;
    const s2 = readSettings();
    // グループ（埋める・並べる・書く・選ぶ）から1つずつ、問題数の足りる形式を選ぶ
    const pick = [];
    ['fill', 'order', 'write', 'choose'].forEach(function (g) {
      const f = AUTO_ORDER.filter(function (v) { return formOf(v).g === g && poolFor(v, s2).length >= 5; })[0];
      if (f) pick.push(f);
    });
    $$('input[name="gform"]').forEach(function (el) { el.checked = has(pick, el.value); });
    refresh();
  });
  refresh();

  // ---------- 問題の組み立て ----------
  function ordered(list, s) {
    if (s.order === 'list') return list.sort(function (x, y) { return x._i - y._i; });
    return shuffle(list);
  }

  function blankText(answer, hint) {
    if (hint === 'none') return '(　　　　　　)';
    if (hint === 'count') {
      // 改行しない空白（ ）でつなぎ、空所が行の途中で切れないようにする
      return answer.split('').map(function (c, i) { return i === 0 || !/[A-Za-z]/.test(c) ? c : '_'; }).join(' ');
    }
    return '(' + answer.charAt(0) + '________)';
  }

  function makeWordSet(s) {
    const p = planWord(s);
    let chosen = [];
    if (p.wantCloze && !p.wantMeaning) {
      chosen = sample(p.withEx, p.wordN);
    } else if (p.wantCloze) {
      const a = sample(p.withEx, Math.min(p.wordN, p.withEx.length));
      const used = {}; a.forEach(function (w) { used[w.id] = true; });
      chosen = a.concat(sample(p.words.filter(function (w) { return !used[w.id]; }), p.wordN - a.length));
    } else if (p.wantMeaning) {
      chosen = sample(p.words, p.wordN);
    }
    ordered(chosen, s);
    const meaning = p.wantMeaning ? chosen.map(function (w) {
      const d = s.dir === 'mix' ? (Math.random() < 0.5 ? 'en2ja' : 'ja2en') : s.dir;
      return { w: w, dir: d };
    }) : [];
    const usedEn = {};
    const cloze = p.wantCloze ? chosen.map(function (w) {
      const c = splitCloze(w);
      if (!c || usedEn[w.example_en]) return null;
      usedEn[w.example_en] = true;
      return Object.assign({ w: w }, c);
    }).filter(Boolean) : [];
    return { mode: 'word', settings: s, meaning: meaning, cloze: cloze };
  }

  function makeGrammarSet(s) {
    const usedEn = {};
    const sections = [];
    GFORMS.forEach(function (f) {
      if (!has(s.gforms, f.v)) return;
      const pool = poolFor(f.v, s);
      // 解説のある新しい文法問題を優先し、足りない分を短文で補う
      // まだ使っていない英文を優先し、足りなければほかの大問で使った英文も使う（同じ大問の中では重ねない）
      const pick = [], inSec = {};
      const cand = shuffle(pool.filter(function (it) { return it.src === 'g'; })).concat(shuffle(pool.filter(function (it) { return it.src === 's'; })));
      [false, true].forEach(function (allowUsed) {
        cand.some(function (it) {
          if (pick.length >= s.count) return true;
          if (inSec[it.en] || (!allowUsed && usedEn[it.en])) return false;
          inSec[it.en] = true; pick.push(it);
          return false;
        });
      });
      pick.forEach(function (it) { usedEn[it.en] = true; });
      const items = ordered(pick, s).map(function (it) {
        const q = { it: it };
        if (it.blankAt >= 0) {
          q.before = it.en.slice(0, it.blankAt); q.answer = it.blank; q.after = it.en.slice(it.blankAt + it.blank.length);
        }
        if (f.v === 'choice') {
          q.options = shuffle([it.blank].concat(it.choices));
          q.correct = q.options.indexOf(it.blank);
        }
        if (f.v === 'reorder') {
          if (s.rtype === 'part') {
            q.tokens = it.focus.trim().split(/\s+/);
            q.shuffled = scramble(q.tokens);
            const k = it.en.indexOf(it.focus);
            q.pre = it.en.slice(0, k); q.post = it.en.slice(k + it.focus.length);
          } else {
            const r = reorderParts(it.en);
            q.tokens = r.tokens; q.end = r.end; q.shuffled = scramble(r.tokens);
          }
        }
        if (f.v === 'trans' && s.ttype === 'part') {
          const k = it.ja.indexOf(it.ja_blank);
          q.jpre = it.ja.slice(0, k); q.jpost = it.ja.slice(k + it.ja_blank.length);
        }
        return q;
      });
      if (items.length) sections.push({ f: f.v, rtype: s.rtype, ttype: s.ttype, items: items });
    });
    return { mode: 'grammar', settings: s, sections: sections };
  }

  function makeSet(s) { return s.mode === 'grammar' ? makeGrammarSet(s) : makeWordSet(s); }
  function setSize(set) {
    if (set.mode === 'grammar') return set.sections.reduce(function (a, x) { return a + x.items.length; }, 0);
    return set.meaning.length + set.cloze.length;
  }

  // ---------- Word の中身 ----------
  const NUM_W = 700;   // 番号の幅（2桁でもそろう）
  const TEXT_W = 9638; // A4 縦・余白 20mm の本文幅（twip）
  const DIR_LABEL = { en2ja: '英語 → 日本語', ja2en: '日本語 → 英語', mix: '英語 ⇄ 日本語' };
  const DIR_GUIDE = {
    en2ja: '次の英単語の意味を日本語で書きなさい。',
    ja2en: '次の日本語に合う英単語を書きなさい。',
    mix: '英語は日本語に、日本語は英語に直しなさい。'
  };
  const SEC = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];
  const CIRCLED = ['①', '②', '③', '④'];

  function titleOf(s) {
    if (s.title) return s.title;
    if (s.mode === 'grammar') {
      const g = s.grammars || [];
      return '文法ワーク' + (g.length && g.length <= 3 ? '（' + g.join('・') + '）' : '');
    }
    return '英検' + s.grade + ' 単語ワーク';
  }
  function formOf(v) { return GFORMS.filter(function (f) { return f.v === v; })[0]; }

  function docBlocks(set, isAnswer) {
    const s = set.settings;
    const B = [];
    const kindLabel = isAnswer ? '解答' : '問題';
    const contents = [];
    if (set.mode === 'grammar') {
      set.sections.forEach(function (sec) { contents.push(formOf(sec.f).label + ' ' + sec.items.length + '問'); });
      if (s.grammars && s.grammars.length) contents.push('文法：' + s.grammars.join('・'));
    } else {
      if (set.meaning.length) contents.push('単語の意味（' + DIR_LABEL[s.dir] + '）' + set.meaning.length + '問');
      if (set.cloze.length) contents.push('単語の穴埋め ' + set.cloze.length + '問');
    }

    let first = true;
    function push(p) {
      if (first && s.titlePage) p.pageBreakBefore = true;
      first = false;
      B.push(p);
    }
    if (s.titlePage) {
      B.push({ runs: [], before: 4200 });
      B.push({ runs: [{ t: titleOf(s), b: true, sz: 56 }], align: 'center', after: 360, line: 360 });
      B.push({ runs: [{ t: '【' + kindLabel + '】', b: true, sz: 40 }], align: 'center', after: 720 });
      contents.forEach(function (c) { B.push({ runs: [{ t: c, sz: 28 }], align: 'center', after: 120 }); });
    } else {
      B.push({ runs: [{ t: titleOf(s), b: true, sz: 34 }, { t: '　【' + kindLabel + '】', b: true, sz: 28 }], after: 120 });
      B.push({ runs: [{ t: contents.join('　／　'), sz: 22 }], after: 240 });
      first = false;
    }

    let sec = 0;
    function heading(text, guide) {
      push({ runs: [{ t: SEC[sec++] + '　' + text, b: true, sz: 28 }], before: sec > 1 ? 360 : 120, after: 60, keepNext: true });
      B.push({ runs: [{ t: guide, sz: 24 }], after: 200, keepNext: true });
    }
    // 番号つきの1行目
    function numLine(i, runs, keep) {
      B.push({ runs: [{ t: (i + 1) + '.\t' }].concat(runs), left: NUM_W, hanging: NUM_W, after: 40, keepNext: keep !== false, tabs: [{ pos: NUM_W }] });
    }
    // 2行目以降（番号の位置にそろえる）
    function line(runs, opt) {
      B.push(Object.assign({ runs: runs, left: NUM_W, after: 240, line: 360 }, opt || {}));
    }
    // 解答を書く線
    // roomy：上に1行分あけて、書くスペースを広くとる（並べ替え用）
    function answerLine(last, roomy) {
      B.push({ runs: [{ t: '\t' }], left: NUM_W, before: roomy ? 420 : 0, after: last ? 240 : 60, line: 360, keepLines: true, tabs: [{ pos: TEXT_W, val: 'right', leader: 'underscore' }] });
    }
    // 英文・和訳をまるごと書く問題の解答欄：n本の線を、行の間をあけて引く（2026-11-20 ユーザー「書く場所が狭い」）
    function writeSpace(n) {
      for (let k = 0; k < n; k++) {
        B.push({ runs: [{ t: '\t' }], left: NUM_W, before: k === 0 ? 480 : 620, after: k === n - 1 ? 360 : 0, line: 360, keepLines: true, keepNext: k < n - 1, tabs: [{ pos: TEXT_W, val: 'right', leader: 'underscore' }] });
      }
    }
    function explainLine(it) {
      if (isAnswer && s.explain && it.explain) B.push({ runs: [{ t: '解説：' + it.explain, sz: 20 }], left: NUM_W, after: 200, keepLines: true });
    }
    function clozeRuns(q, hint) {
      const mid = isAnswer ? { t: q.answer, b: true, u: true } : { t: blankText(q.answer, hint) };
      return [{ t: q.before }, mid, { t: q.after }];
    }

    if (set.mode !== 'grammar') {
      if (set.meaning.length) {
        heading('単語の意味', DIR_GUIDE[s.dir]);
        set.meaning.forEach(function (q, i) {
          const prompt = q.dir === 'en2ja' ? q.w.en : q.w.ja;
          const ans = q.dir === 'en2ja' ? q.w.ja : q.w.en;
          if (isAnswer) {
            B.push({ runs: [{ t: (i + 1) + '.\t' + prompt + '\t' }, { t: ans, b: true }], left: NUM_W, hanging: NUM_W, after: 120, tabs: [{ pos: NUM_W }, { pos: 4820, leader: 'dot' }] });
          } else {
            B.push({ runs: [{ t: (i + 1) + '.\t' + prompt + '　\t' }], left: NUM_W, hanging: NUM_W, after: 200, line: 360, tabs: [{ pos: NUM_W }, { pos: TEXT_W, val: 'right', leader: 'underscore' }] });
          }
        });
      }
      if (set.cloze.length) {
        heading('単語の穴埋め', '日本語の意味に合うように、空所に適する英語を書きなさい。');
        set.cloze.forEach(function (q, i) { numLine(i, [{ t: q.ja }]); line(clozeRuns(q, s.hint)); });
      }
      return B;
    }

    // ---- 文法ワーク ----
    set.sections.forEach(function (sc) {
      const f = formOf(sc.f);
      const guide = (sc.f === 'trans' && sc.ttype === 'part') ? f.guidePart : f.guide;
      heading(f.title + (sc.f === 'reorder' && sc.rtype === 'part' ? '（文法部分）' : ''), guide);
      sc.items.forEach(function (q, i) {
        const it = q.it;
        switch (sc.f) {
          case 'choice':
            numLine(i, [{ t: it.ja }]);
            if (isAnswer) {
              line(clozeRuns(q).concat([{ t: '　… ' + CIRCLED[q.correct], b: true }]));
            } else {
              line([{ t: q.before + '(　　　　)' + q.after }], { after: 40, keepNext: true });
              line([{ t: q.options.map(function (o, k) { return CIRCLED[k] + ' ' + o; }).join('　　') }]);
            }
            break;
          case 'cloze':
            numLine(i, [{ t: it.ja }]); line(clozeRuns(q, s.hint));
            break;
          case 'inflect':
            numLine(i, [{ t: it.ja }]);
            if (isAnswer) line(clozeRuns(q));
            else { line([{ t: q.before + '( ' + it.base + ' )' + q.after }], { after: 40, keepNext: true }); B.push({ runs: [{ t: '→ \t' }], left: NUM_W, after: 240, line: 360, tabs: [{ pos: 5200, val: 'right', leader: 'underscore' }] }); }
            break;
          case 'reorder':
            numLine(i, [{ t: it.ja }]);
            if (isAnswer) line([{ t: it.en, b: true }]);
            else if (sc.rtype === 'part') { line([{ t: q.pre + '( ' + q.shuffled.join(' / ') + ' )' + q.post }], { after: 60, keepNext: true }); answerLine(true, true); }
            else { line([{ t: '( ' + q.shuffled.join(' / ') + ' )' + q.end }], { after: 60, keepNext: true }); writeSpace(2); }
            break;
          case 'trans':
            numLine(i, [{ t: it.en }]);
            if (sc.ttype === 'part') line(isAnswer ? [{ t: q.jpre }, { t: it.ja_blank, b: true, u: true }, { t: q.jpost }] : [{ t: q.jpre + '（　　　　　　　　）' + q.jpost }]);
            else if (isAnswer) line([{ t: it.ja, b: true }]);
            else writeSpace(2);
            break;
          case 'compose':
            numLine(i, [{ t: it.ja }]);
            if (isAnswer) line([{ t: it.en, b: true }]); else writeSpace(2);
            break;
          case 'rewrite':
            numLine(i, [{ t: it.rewrite.from + '　' }, { t: '（' + it.rewrite.task + '）', sz: 22 }]);
            if (isAnswer) line([{ t: it.en, b: true }]); else writeSpace(2);
            break;
          case 'correct':
            numLine(i, [{ t: it.error }]);
            if (isAnswer) line([{ t: it.en, b: true }]); else writeSpace(2);
            break;
          case 'answer':
            numLine(i, [{ t: it.en + '　' }, { t: '（' + (it.qa_hint || '') + '）', sz: 22 }]);
            if (isAnswer) line([{ t: it.qa, b: true }]); else writeSpace(2);
            break;
          case 'pattern':
            numLine(i, [{ t: it.en }]);
            line(isAnswer ? [{ t: it.pattern, b: true }] : [{ t: '第（　　　）文型' }]);
            break;
        }
        explainLine(it);
      });
    });
    return B;
  }

  function stamp() {
    const d = new Date();
    const z = function (n) { return ('0' + n).slice(-2); };
    return z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes());
  }
  function safeName(s) { return s.replace(/[\\/:*?"<>|\s]+/g, '_'); }

  function buildFiles(s, givenSet) {
    const set = givenSet || makeSet(s);
    if (!setSize(set)) throw new Error('出題できる問題がありません。');
    const base = safeName(titleOf(s)) + '_' + stamp();
    const opts = function (isAnswer) {
      return { blocks: docBlocks(set, isAnswer), font: FONT, size: 26, titlePage: s.titlePage, title: titleOf(s) };
    };
    return {
      set: set,
      problem: { name: base + '_問題.docx', bytes: Docx.build(opts(false)) },
      answer: { name: base + '_解答.docx', bytes: Docx.build(opts(true)) }
    };
  }

  function download(f) {
    const blob = new Blob([f.bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function say(text, isErr) { $('#msg').textContent = text; $('#msg').className = isErr ? 'err' : ''; }

  function checkSettings(s) {
    if (s.count < 1) return '問題数を1以上にしてください。';
    if (s.mode === 'grammar') {
      if (!s.gforms.length) return '形式を1つ以上選んでください（「おまかせで選ぶ」も使えます）。';
      const p = planGrammar(s);
      if (!Object.keys(p).some(function (k) { return p[k] > 0; })) return 'この組み合わせでは出題できる問題がありません。';
      return '';
    }
    if (!s.forms.length) return '形式を1つ以上選んでください。';
    const p = planWord(s);
    if (!p.meaningN && !p.clozeN) return 'この組み合わせでは出題できる問題がありません。';
    return '';
  }

  // ---------- プレビュー ----------
  // プレビューした問題をそのまま出力するため、選んだ問題（set）を覚えておく。
  // 出題に関わる条件が変わったら捨てる（タイトル・表紙・解説の有無だけの変更なら描き直すだけ）。
  let current = null; // { key, set }
  let pvKind = 'problem';
  function setKey(s) {
    return JSON.stringify([s.mode, s.mode === 'grammar' ? '' : s.grade, s.grammars, s.forms, s.gforms, s.rtype, s.ttype, s.dir, s.hint, s.count, s.order]);
  }

  function drawPreview() {
    if (!current) return;
    const s = readSettings();
    const blocks = docBlocks(Object.assign({}, current.set, { settings: s }), pvKind === 'answer');
    $('#preview').hidden = false;
    const n = Preview.render($('#pvPages'), blocks, { titlePage: s.titlePage });
    $('#pvInfo').textContent = (pvKind === 'answer' ? '解答' : '問題') + '：' + n + 'ページ（目安）';
    $$('.pv-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.kind === pvKind); });
  }

  function onSettingsChanged() {
    if (!current) return;
    if (current.key !== setKey(readSettings())) {
      current = null;
      $('#preview').hidden = true;
      say('条件が変わりました。もう一度「プレビュー」を押すと、新しい問題で表示します。');
    } else {
      drawPreview();
    }
  }
  document.addEventListener('change', onSettingsChanged);
  $('#count').addEventListener('input', onSettingsChanged);
  $('#title').addEventListener('input', onSettingsChanged);
  $('#btnAuto').addEventListener('click', onSettingsChanged);

  function makePreview() {
    const s = readSettings();
    const err = checkSettings(s);
    if (err) return say(err, true);
    const set = makeSet(s);
    if (!setSize(set)) return say('出題できる問題がありません。', true);
    current = { key: setKey(s), set: set };
    say('');
    drawPreview();
    $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#btnPreview').addEventListener('click', makePreview);
  $('#btnReroll').addEventListener('click', makePreview);
  $$('.pv-tabs button').forEach(function (b) {
    b.addEventListener('click', function () { pvKind = b.dataset.kind; drawPreview(); });
  });
  let resizeTimer = 0;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawPreview, 200); });

  $('#btnOut').addEventListener('click', function () {
    const s = readSettings();
    const err = checkSettings(s);
    if (err) return say(err, true);
    try {
      const usePreview = current && current.key === setKey(s);
      const f = buildFiles(s, usePreview ? current.set : null);
      download(f.problem);
      setTimeout(function () { download(f.answer); }, 600);
      say('出力しました：' + f.problem.name + ' と ' + f.answer.name + (usePreview ? '（プレビューと同じ問題）' : ''));
    } catch (e) {
      say('出力できませんでした：' + e.message, true);
    }
  });

  // ---------- 印刷画面 ----------
  // プレビューと同じ問題で、問題・解答を1つの印刷画面にまとめて開く。
  $('#btnPrint').addEventListener('click', function () {
    const s = readSettings();
    const err = checkSettings(s);
    if (err) return say(err, true);
    const w = window.open('', '_blank');
    if (!w) return say('印刷画面がブロックされました。ポップアップを許可してください。', true);
    if (!current || current.key !== setKey(s)) {
      const set = makeSet(s);
      if (!setSize(set)) { w.close(); return say('出題できる問題がありません。', true); }
      current = { key: setKey(s), set: set };
    }
    const saved = pvKind;
    const html = {};
    ['problem', 'answer'].forEach(function (k) {
      pvKind = k; drawPreview();
      html[k] = $('#pvPages').firstChild.innerHTML;
    });
    pvKind = saved; drawPreview();
    const css = new URL('css/style.css', location.href).href;
    function pages(h) { return (h.match(/class="pv-page/g) || []).length; }
    w.document.open();
    w.document.write('<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>' + titleOf(s).replace(/</g, '&lt;') + '</title>' +
      '<link rel="stylesheet" href="' + css + '">' +
      // 画面には印刷ボタンだけを真ん中に大きく出す（ページの表示はしない）。印刷するときだけページを出す（2026-11-20 ユーザー指示）
      '<style>' +
      'body{margin:0;background:#efe9dd;font-family:"Yu Gothic UI","Yu Gothic","Hiragino Sans",sans-serif;color:#2b2a27}' +
      '.menu{min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:24px 16px;text-align:center}' +
      '.menu h1{font-size:24px;margin:0}' +
      '.menu .info{font-size:15px;color:#6b665c;margin:0}' +
      '.btns{display:flex;flex-direction:column;gap:14px;width:min(360px,100%)}' +
      '.btns button{font:inherit;font-size:22px;font-weight:700;padding:18px 20px;border-radius:12px;cursor:pointer;border:2px solid #2f5d8a;background:#fff;color:#2f5d8a}' +
      '.btns button.main{background:#2f5d8a;color:#fff}' +
      '.btns button:hover{filter:brightness(.95)}.btns button:focus-visible{outline:3px solid #2b2a27;outline-offset:2px}' +
      '.menu .note{font-size:14px;color:#6b665c;margin:0;max-width:360px}' +
      '.sheet{display:none}' +
      'body.only-problem #answer,body.only-answer #problem{display:none}' +
      '@media print{@page{size:A4;margin:0}body{background:#fff}.menu{display:none}.sheet{display:block;padding:0}' +
      '.sheet .pv-page{margin:0;box-shadow:none;height:296mm;break-after:page;page-break-after:always}' +
      '#answer .pv-page:last-child{break-after:auto;page-break-after:auto}' +
      'body.only-problem #problem .pv-page:last-child,body.only-answer #answer .pv-page:last-child{break-after:auto;page-break-after:auto}}' +
      '</style></head><body>' +
      '<div class="menu"><h1>' + titleOf(s).replace(/</g, '&lt;') + '</h1>' +
      '<p class="info">問題 ' + pages(html.problem) + 'ページ ／ 解答 ' + pages(html.answer) + 'ページ</p>' +
      '<div class="btns"><button type="button" class="main" data-k="problem">問題を印刷</button>' +
      '<button type="button" class="main" data-k="answer">解答を印刷</button>' +
      '<button type="button" data-k="both">両方を印刷</button></div>' +
      '<p class="note">押すと印刷の画面が出ます。プリンターの代わりに「PDFとして保存」を選ぶと、PDFにもできます。</p></div>' +
      '<div class="sheet"><div id="problem">' + html.problem + '</div><div id="answer">' + html.answer + '</div></div>' +
      '<script>document.querySelectorAll("button[data-k]").forEach(function(b){b.addEventListener("click",function(){' +
      'var k=b.getAttribute("data-k");document.body.className=k==="both"?"":"only-"+k;setTimeout(function(){window.print();},50)})});' +
      'window.addEventListener("afterprint",function(){document.body.className=""});<\/script></body></html>');
    w.document.close();
    say('印刷画面を開きました。');
  });

  // 動作確認用（画面からは使わない）
  window.WB = {
    buildFiles: buildFiles, readSettings: readSettings, splitCloze: splitCloze, reorderParts: reorderParts,
    docBlocks: docBlocks, poolFor: poolFor, planGrammar: planGrammar, GPOOL: GPOOL, current: function () { return current; }
  };
})();

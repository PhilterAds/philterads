// Zap selector generation (zap.js): the pure half. The DOM sits behind a
// tiny adapter, so these tests run a node-model tree instead of a page —
// the generator's job is the *decision* (which form is stable, unique, and
// never html/body), and that is exactly what the adapter isolates.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import '../zap.js';

const { isStableClass, idUsable, buildSelector } = globalThis.ZapSelect;

// Minimal element model: { tag, id, classes, children?, parent, nth } where
// nth is the 1-based index among same-tag siblings (precomputed like the
// page adapter would).
const el = (tag, { id = '', classes = [], children = [] } = {}) => {
  const node = { tag, id, classes, children, parent: null, nth: 1 };
  for (const c of children) c.parent = node;
  return node;
};

// Adapter over the model. `counts` maps selector -> match count to imitate
// document.querySelectorAll; unlisted selectors match exactly one node.
const adapter = (root, counts = new Map()) => ({
  tag: (n) => n.tag,
  idOf: (n) => n.id,
  classes: (n) => n.classes.filter(isStableClass),
  escape: (s) => s,
  matches: (sel) => (counts.has(sel) ? counts.get(sel) : 1),
  parent: (n) => n.parent,
  nthOfType: (n) => n.nth,
});

// label each node with its nth-of-type, like the real DOM
function numberSiblings(node) {
  const byTag = {};
  for (const c of node.children) {
    byTag[c.tag] = (byTag[c.tag] || 0) + 1;
    c.nth = byTag[c.tag];
  }
  for (const c of node.children) numberSiblings(c);
  return node;
}

test('stability filters: digit runs and hash-like names are unstable', () => {
  assert.strictEqual(isStableClass('ad-banner'), true);
  assert.strictEqual(isStableClass('sidebar'), true);
  assert.strictEqual(isStableClass('ad-728x90'), false); // digits
  assert.strictEqual(isStableClass('xJqkWvZbLc'), false); // 8+ consonant run
  assert.strictEqual(isStableClass(''), false);

  assert.strictEqual(idUsable('top-ad'), true);
  assert.strictEqual(idUsable(''), false);
  assert.strictEqual(idUsable('ad-16843213548'), false); // run of 3+ digits
  assert.strictEqual(idUsable('a'.repeat(25)), false); // longer than 24
  assert.strictEqual(idUsable('x'.repeat(24)), true);
});

test('a stable unique id wins', () => {
  const tree = numberSiblings(el('body', { children: [el('div', { id: 'footer-ad', children: [] })] }));
  const ad = tree.children[0];
  assert.strictEqual(buildSelector(ad, adapter(tree)), '#footer-ad');
});

test('an unstable or non-unique id is not used', () => {
  const tree = numberSiblings(el('body', { children: [el('div', { id: 'ad-987654321' })] }));
  assert.strictEqual(buildSelector(tree.children[0], adapter(tree)), 'body > div:nth-of-type(1)');

  const two = numberSiblings(el('body', { children: [el('div', { id: 'dup' }), el('div', { id: 'dup' })] }));
  const counts = new Map([['#dup', 2]]);
  assert.strictEqual(buildSelector(two.children[1], adapter(two, counts)), 'body > div:nth-of-type(2)');
});

test('tag + stable classes when unique, unstable classes dropped', () => {
  const tree = numberSiblings(el('body', { children: [
    el('div', { classes: ['promo', 'a-460x60'] }),
    el('div', { classes: ['promo'] }),
  ] }));
  // both divs have class promo but only the second keeps exactly that set
  const counts = new Map([['div.promo', 2]]);
  assert.strictEqual(buildSelector(tree.children[1], adapter(tree, counts)), 'body > div:nth-of-type(2)');

  const unique = new Map([['div.promo', 1]]);
  assert.strictEqual(buildSelector(tree.children[1], adapter(tree, unique)), 'div.promo');
});

test('nth-of-type path anchors at the nearest stably-id’d ancestor', () => {
  const tree = numberSiblings(el('body', { children: [
    el('main', { id: 'content', children: [
      el('div', { children: [el('span', { id: 'ad-slot-773' })] }),
    ] }),
  ] }));
  const span = tree.children[0].children[0].children[0];
  assert.strictEqual(buildSelector(span, adapter(tree)), '#content > div:nth-of-type(1) > span:nth-of-type(1)');
});

test('the anchor search stops after 6 levels and falls back to body', () => {
  // #far-up is 8 levels above the span: past the 6-level anchor search
  const deep = el('body', { children: [
    el('div', { id: 'far-up', children: [
      el('div', { children: [el('div', { children: [el('div', { children: [
        el('div', { children: [el('div', { children: [el('div', { children: [
          el('span'),
        ] })] })] })] })] })] }),
    ] }),
  ] });
  numberSiblings(deep);
  const descend = (n, steps) => (steps ? descend(n.children[0], steps - 1) : n);
  const span = descend(deep, 8); // body #far-up d1 d2 d3 d4 d5 d6 span
  assert.strictEqual(span.tag, 'span');
  // unique by construction, anchored at body, includes the id'd ancestor as
  // a plain nth-of-type step (still exactly one element matched)
  assert.strictEqual(
    buildSelector(span, adapter(deep)),
    'body > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1)'
      + ' > div:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) > span:nth-of-type(1)',
  );
});

test('a selector that matches more than one element is rejected', () => {
  const tree = numberSiblings(el('body', { children: [el('div', { classes: ['promo'] }), el('aside')] }));
  const counts = new Map([['div.promo', 1], ['body > div:nth-of-type(1)', 2]]);
  assert.strictEqual(buildSelector(tree.children[0], adapter(tree, counts)), 'div.promo');
  // everything non-unique, including the path: refuse
  const allBad = new Map([['div.promo', 2], ['body > div:nth-of-type(1)', 3]]);
  assert.strictEqual(buildSelector(tree.children[0], adapter(tree, allBad)), null);
});

test('html and body are never selected', () => {
  const tree = numberSiblings(el('body', { children: [] }));
  assert.strictEqual(buildSelector(tree, adapter(tree)), null); // body itself
  const html = { tag: 'html', id: '', classes: [], children: [tree], parent: null, nth: 1 };
  tree.parent = html;
  assert.strictEqual(buildSelector(html, adapter(html)), null);
});

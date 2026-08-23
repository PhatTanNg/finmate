/** Tự động phân loại giao dịch: luật do người dùng/hệ thống học + so khớp từ khoá. */
import { all, get, run, insert } from '../db.js';
import { norm, scoreKeywords } from '../util/vi.js';
import { defaultFundIdForCategory } from '../bootstrap.js';

function matches(rule, text, merchant, amount, accountId) {
  const hay = norm(rule.match_field === 'merchant' ? merchant || '' : `${text || ''} ${merchant || ''}`);
  const pat = rule.match_field === 'amount' || rule.match_field === 'account' ? rule.pattern : norm(rule.pattern);
  switch (rule.match_type) {
    case 'equals':
      return hay === pat;
    case 'starts':
      return hay.startsWith(pat);
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(rule.match_field === 'merchant' ? merchant || '' : `${text || ''} ${merchant || ''}`);
      } catch {
        return false;
      }
    case 'amount_eq':
      return Number(amount) === Number(rule.pattern);
    case 'account_eq':
      return Number(accountId) === Number(rule.pattern);
    case 'contains':
    default:
      return pat.length > 0 && hay.includes(pat);
  }
}

/**
 * @returns {{category_id:number|null, fund_id:number|null, merchant:string|null, confidence:number, rule_id:number|null, excluded:number}}
 */
export function autoCategorize({ text = '', merchant = '', type = 'expense', amount = 0, accountId = null } = {}) {
  const rules = all('SELECT * FROM rules WHERE active = 1 ORDER BY priority ASC, id ASC');
  for (const r of rules) {
    if (r.account_id && accountId && r.account_id !== accountId) continue;
    if (matches(r, text, merchant, amount, accountId)) {
      run('UPDATE rules SET hits = hits + 1 WHERE id = ?', [r.id]);
      const cat = r.category_id ? get('SELECT * FROM categories WHERE id = ?', [r.category_id]) : null;
      if (cat && cat.kind !== type && type !== 'transfer') continue;
      return {
        category_id: r.category_id || null,
        fund_id: r.fund_id || defaultFundIdForCategory(r.category_id),
        merchant: r.set_merchant || merchant || null,
        confidence: 0.98,
        rule_id: r.id,
        excluded: r.set_excluded || 0,
      };
    }
  }

  if (type === 'transfer') return { category_id: null, fund_id: null, merchant: merchant || null, confidence: 1, rule_id: null, excluded: 0 };

  const cats = all('SELECT * FROM categories WHERE kind = ?', [type]);
  let best = null;
  let bestScore = 0;
  for (const c of cats) {
    const kws = (c.keywords || '').split(',').map((s) => s.trim()).filter(Boolean);
    const score = scoreKeywords(`${text} ${merchant}`, kws);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best) {
    return {
      category_id: best.id,
      fund_id: defaultFundIdForCategory(best.id),
      merchant: merchant || null,
      confidence: Math.min(0.95, 0.6 + bestScore * 0.1),
      rule_id: null,
      excluded: 0,
    };
  }
  const fallback = get('SELECT * FROM categories WHERE kind = ? AND name = ?', [type, type === 'income' ? 'Thu khác' : 'Chi khác']);
  return {
    category_id: fallback ? fallback.id : null,
    fund_id: fallback ? defaultFundIdForCategory(fallback.id) : null,
    merchant: merchant || null,
    confidence: 0.35,
    rule_id: null,
    excluded: 0,
  };
}

/** Ghi nhớ khi người dùng sửa danh mục -> lần sau tự đúng. */
export function learnRule({ pattern, category_id, fund_id, name, match_field = 'text' }) {
  if (!pattern || String(pattern).trim().length < 3) return null;
  const existing = get('SELECT * FROM rules WHERE lower(pattern) = lower(?) AND match_field = ?', [pattern, match_field]);
  if (existing) {
    run('UPDATE rules SET category_id = ?, fund_id = ?, active = 1 WHERE id = ?', [category_id || null, fund_id || null, existing.id]);
    return existing.id;
  }
  return insert('rules', {
    name: name || `Tự học: ${pattern}`,
    match_field,
    match_type: 'contains',
    pattern: String(pattern).trim(),
    category_id: category_id || null,
    fund_id: fund_id || null,
    priority: 50,
    learned: 1,
  });
}

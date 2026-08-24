/**
 * Chọn hệ thống thuế theo nơi cư trú thuế của người dùng.
 * Việt Nam -> tax.js (TNCN luỹ tiến, BHXH, giảm trừ gia cảnh)
 * Ireland   -> tax_ie.js (PAYE 20/40 + tín dụng thuế, USC, PRSI)
 */
import { get } from '../db.js';
import * as vn from './tax.js';
import * as ie from './tax_ie.js';
import { convert } from './fx.js';
import { today } from '../util/date.js';
import { currency as cur } from '../util/currency.js';

/** Đồng tiền dùng để tính thuế ở mỗi nước. */
export const TAX_CURRENCY = { VN: 'VND', IE: 'EUR' };

export const COUNTRIES = {
  VN: { code: 'VN', name: 'Việt Nam', flag: '🇻🇳', currency: 'VND' },
  IE: { code: 'IE', name: 'Ireland', flag: '🇮🇪', currency: 'EUR' },
};

export function taxCountry() {
  const p = get('SELECT tax_country, country FROM profile WHERE id = 1');
  const c = (p && (p.tax_country || p.country)) || 'VN';
  return COUNTRIES[String(c).toUpperCase()] ? String(c).toUpperCase() : 'VN';
}

export function taxCurrency(country = taxCountry()) {
  return TAX_CURRENCY[country] || 'VND';
}

/** Lương gộp -> thực nhận, theo đúng nước cư trú thuế. */
export function grossToNetAuto(gross, opts = {}) {
  const country = opts.country || taxCountry();
  return country === 'IE' ? ie.grossToNetIE(gross, opts) : { country: 'VN', ...vn.grossToNet(gross, opts) };
}

export function netToGrossAuto(net, opts = {}) {
  const country = opts.country || taxCountry();
  return country === 'IE' ? ie.netToGrossIE(net, opts) : { country: 'VN', ...vn.netToGross(net, opts) };
}

export function taxConfigAuto(country = taxCountry()) {
  return country === 'IE'
    ? { country: 'IE', currency: 'EUR', year: ie.TAX_YEAR, ...ie.config(), other_rates: ie.OTHER_RATES_IE }
    : { country: 'VN', currency: 'VND', ...vn.config(), other_rates: vn.OTHER_RATES };
}

/**
 * Ước tính thuế năm. Quy đổi số tiền của từng nguồn thu về đồng tiền tính
 * thuế trước, vì nguồn thu có thể ghi bằng nhiều đồng tiền khác nhau.
 */
export function estimateAnnualTaxAuto(streams = [], opts = {}) {
  const country = opts.country || taxCountry();
  const tc = taxCurrency(country);
  const d = today();
  const normalized = streams.map((s) => {
    const sc = cur(s.currency || tc).code;
    if (sc === tc) return s;
    return {
      ...s,
      gross_amount: convert(s.gross_amount || 0, sc, tc, d),
      net_amount: convert(s.net_amount || 0, sc, tc, d),
      insurance_base: convert(s.insurance_base || 0, sc, tc, d),
    };
  });
  const res = country === 'IE' ? ie.estimateAnnualTaxIE(normalized, opts) : vn.estimateAnnualTax(normalized);
  return { ...res, country, currency: tc };
}

export { vn, ie };

import React, { useState } from 'react';
import Chat from '../src/pages/Chat.jsx';
import Dashboard from '../src/pages/Dashboard.jsx';
import Transactions from '../src/pages/Transactions.jsx';
import Accounts from '../src/pages/Accounts.jsx';
import Funds from '../src/pages/Funds.jsx';
import Goals from '../src/pages/Goals.jsx';
import Budgets from '../src/pages/Budgets.jsx';
import Income from '../src/pages/Income.jsx';
import Investments from '../src/pages/Investments.jsx';
import Debts from '../src/pages/Debts.jsx';
import Fire from '../src/pages/Fire.jsx';
import Advisor from '../src/pages/Advisor.jsx';
import Insights from '../src/pages/Insights.jsx';
import Currency from '../src/pages/Currency.jsx';
import Automation from '../src/pages/Automation.jsx';
import Settings from '../src/pages/Settings.jsx';

export const PAGES = {
  Chat, Dashboard, Transactions, Accounts, Funds, Goals, Budgets,
  Income, Investments, Debts, Fire, Advisor, Insights, Currency, Automation, Settings,
};
export { setBaseCurrency } from '../src/lib/format.js';
export { React };
export function Wrap({ Comp, props }) {
  const [, force] = useState(0);
  return React.createElement(Comp, { onRefresh: () => force((x) => x + 1), ...props });
}

export class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { this.props.onError?.(err); }
  render() { return this.state.err ? React.createElement('div', null, 'CRASH: ' + this.state.err.message) : this.props.children; }
}

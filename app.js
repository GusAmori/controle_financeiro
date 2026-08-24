const STORAGE_KEY = 'meu_controle_gastos_v1';
const state = loadState();
let currentMonth = monthKey(new Date());
let paymentType = 'avista';
let deferredInstallPrompt = null;

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
};

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return parsed && parsed.expenses && parsed.salaries ? parsed : { salaries: {}, expenses: [], purchases: [] };
  } catch {
    return { salaries: {}, expenses: [], purchases: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function monthKey(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(`${dateInput}T12:00:00`);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(month, offset) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dateForInstallment(month, day) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const safeDay = Math.min(day, lastDay);
  return `${y}-${String(m).padStart(2,'0')}-${String(safeDay).padStart(2,'0')}`;
}

function uid(prefix='id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

function switchScreen(screen) {
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === screen));
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.screen === screen));
  if (screen === 'installments') renderInstallments();
  if (screen === 'settings') syncSalaryForm();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderDashboard() {
  $('currentMonthLabel').textContent = monthLabel(currentMonth);
  const expenses = state.expenses.filter(e => e.month === currentMonth);
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const salary = Number(state.salaries[currentMonth] || 0);
  const balance = salary - total;

  $('salaryValue').textContent = money(salary);
  $('expenseValue').textContent = money(total);
  $('expenseCount').textContent = `${expenses.length} ${expenses.length === 1 ? 'lançamento' : 'lançamentos'}`;
  $('balanceValue').textContent = money(balance);
  const balanceCard = document.querySelector('.balance-card');
  balanceCard.classList.toggle('negative', balance < 0);
  balanceCard.classList.toggle('positive', balance >= 0);

  renderCategories(expenses);
  renderExpenses(expenses);
}

function renderCategories(expenses) {
  const totals = {};
  expenses.forEach(e => totals[e.category] = (totals[e.category] || 0) + Number(e.amount));
  const entries = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  const container = $('categoryChart');
  if (!entries.length) {
    $('topCategoryBadge').textContent = 'Sem gastos';
    container.innerHTML = '<div class="empty-state">Adicione seus gastos para ver onde seu dinheiro está indo.</div>';
    return;
  }
  const max = entries[0][1];
  $('topCategoryBadge').textContent = `Maior: ${entries[0][0]}`;
  container.innerHTML = entries.map(([cat, value]) => `
    <div class="bar-row">
      <div class="bar-label" title="${escapeHtml(cat)}">${escapeHtml(cat)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3,(value/max)*100)}%"></div></div>
      <div class="bar-value">${money(value)}</div>
    </div>`).join('');
}

function renderExpenses(expenses) {
  const list = $('expenseList');
  if (!expenses.length) {
    list.innerHTML = '<div class="empty-state">Nenhum gasto lançado neste mês.</div>';
    return;
  }
  const sorted = [...expenses].sort((a,b) => b.date.localeCompare(a.date));
  list.innerHTML = sorted.map(e => `
    <div class="expense-item">
      <div>
        <div class="expense-title">${escapeHtml(e.description)}</div>
        <div class="expense-meta">${escapeHtml(e.category)} · ${formatDate(e.date)}${e.installmentNumber ? ` · Parcela ${e.installmentNumber}/${e.installmentTotal}` : ''}</div>
      </div>
      <div class="expense-amount">${money(e.amount)}</div>
      <button class="delete-btn" aria-label="Excluir" data-delete-expense="${e.id}">×</button>
    </div>`).join('');
}

function renderInstallments() {
  const list = $('installmentList');
  if (!state.purchases.length) {
    list.innerHTML = '<div class="empty-state">Você ainda não cadastrou compras parceladas.</div>';
    return;
  }
  list.innerHTML = state.purchases
    .slice()
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt))
    .map(p => {
      const installments = state.expenses.filter(e => e.purchaseId === p.id).sort((a,b) => a.installmentNumber - b.installmentNumber);
      const paid = installments.filter(i => i.paid).length;
      const remaining = installments.length - paid;
      const remainingValue = installments.filter(i => !i.paid).reduce((s,i) => s + Number(i.amount), 0);
      const pct = installments.length ? (paid/installments.length)*100 : 0;
      return `
        <article class="installment-card">
          <div class="installment-card-head">
            <div>
              <h3>${escapeHtml(p.description)}</h3>
              <p>${escapeHtml(p.category)} · ${money(p.totalAmount)} em ${p.installmentTotal}x</p>
            </div>
            <span class="badge">${paid}/${p.installmentTotal} pagas</span>
          </div>
          <div class="progress"><div style="width:${pct}%"></div></div>
          <div class="installment-stats">
            <div class="stat"><span>Valor da parcela</span><strong>${money(p.installmentAmount)}</strong></div>
            <div class="stat"><span>Faltam</span><strong>${remaining} parcelas</strong></div>
            <div class="stat"><span>Saldo parcelado</span><strong>${money(remainingValue)}</strong></div>
          </div>
          <div class="card-actions">
            <button class="secondary-btn" data-next-paid="${p.id}" ${remaining === 0 ? 'disabled' : ''}>Marcar próxima como paga</button>
            <button class="danger-btn" data-delete-purchase="${p.id}">Excluir</button>
          </div>
        </article>`;
    }).join('');
}

function updateInstallmentPreview() {
  if (paymentType !== 'parcelado') return;
  const total = Number($('amount').value || 0);
  const count = Math.max(2, Number($('installmentCount').value || 2));
  const paid = Math.min(count, Math.max(0, Number($('installmentsPaid').value || 0)));
  $('installmentsPaid').max = count;
  const per = total / count;
  $('installmentPreview').innerHTML = `Cada parcela ficará em <strong>${money(per)}</strong>.<br>${paid} já pagas · ${count-paid} faltando.`;
}

function submitExpense(event) {
  event.preventDefault();
  const description = $('description').value.trim();
  const category = $('category').value;
  const totalAmount = Number($('amount').value);
  const purchaseDate = $('purchaseDate').value;
  if (!description || !purchaseDate || totalAmount <= 0) return;

  if (paymentType === 'avista') {
    state.expenses.push({
      id: uid('exp'), description, category, amount: roundMoney(totalAmount), date: purchaseDate,
      month: monthKey(purchaseDate), paid: true, createdAt: new Date().toISOString()
    });
  } else {
    const count = Math.max(2, Number($('installmentCount').value || 2));
    const paidCount = Math.min(count, Math.max(0, Number($('installmentsPaid').value || 0)));
    const firstMonth = $('firstInstallmentMonth').value || monthKey(purchaseDate);
    const purchaseId = uid('purchase');
    const base = Math.floor((totalAmount / count) * 100) / 100;
    const last = roundMoney(totalAmount - base * (count - 1));
    const day = new Date(`${purchaseDate}T12:00:00`).getDate();

    state.purchases.push({
      id: purchaseId, description, category, totalAmount: roundMoney(totalAmount), installmentTotal: count,
      installmentAmount: roundMoney(totalAmount / count), firstMonth, createdAt: new Date().toISOString()
    });

    for (let i = 0; i < count; i++) {
      const m = addMonths(firstMonth, i);
      state.expenses.push({
        id: uid('exp'), purchaseId,
        description, category, amount: i === count - 1 ? last : base,
        date: dateForInstallment(m, day), month: m,
        installmentNumber: i + 1, installmentTotal: count,
        paid: i < paidCount, createdAt: new Date().toISOString()
      });
    }
  }

  saveState();
  event.target.reset();
  paymentType = 'avista';
  document.querySelectorAll('.segment').forEach(s => s.classList.toggle('active', s.dataset.type === 'avista'));
  $('installmentFields').classList.add('hidden');
  setDefaultDates();
  renderDashboard();
  renderInstallments();
  switchScreen('dashboard');
  showToast('Gasto salvo com sucesso');
}

function deleteExpense(id) {
  const exp = state.expenses.find(e => e.id === id);
  if (!exp) return;
  if (exp.purchaseId) {
    if (!confirm('Esta parcela pertence a uma compra parcelada. Deseja excluir somente esta parcela?')) return;
  }
  state.expenses = state.expenses.filter(e => e.id !== id);
  saveState();
  renderDashboard();
  renderInstallments();
}

function deletePurchase(id) {
  const purchase = state.purchases.find(p => p.id === id);
  if (!purchase) return;
  if (!confirm(`Excluir a compra parcelada "${purchase.description}" e todas as parcelas?`)) return;
  state.purchases = state.purchases.filter(p => p.id !== id);
  state.expenses = state.expenses.filter(e => e.purchaseId !== id);
  saveState();
  renderDashboard();
  renderInstallments();
  showToast('Parcelamento excluído');
}

function markNextPaid(id) {
  const installments = state.expenses.filter(e => e.purchaseId === id).sort((a,b) => a.installmentNumber-b.installmentNumber);
  const next = installments.find(i => !i.paid);
  if (!next) return;
  next.paid = true;
  saveState();
  renderInstallments();
  showToast(`Parcela ${next.installmentNumber}/${next.installmentTotal} marcada como paga`);
}

function saveSalary(event) {
  event.preventDefault();
  const month = $('salaryMonth').value;
  const value = Number($('salaryInput').value || 0);
  state.salaries[month] = roundMoney(value);
  saveState();
  if (month === currentMonth) renderDashboard();
  showToast('Salário salvo');
}

function syncSalaryForm() {
  $('salaryMonth').value = currentMonth;
  $('salaryInput').value = state.salaries[currentMonth] ?? '';
}

function setDefaultDates() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  $('purchaseDate').value = today;
  $('firstInstallmentMonth').value = monthKey(now);
  $('salaryMonth').value = currentMonth;
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-gastos-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.expenses) || !Array.isArray(data.purchases) || typeof data.salaries !== 'object') throw new Error();
      state.salaries = data.salaries;
      state.expenses = data.expenses;
      state.purchases = data.purchases;
      saveState();
      renderDashboard();
      renderInstallments();
      syncSalaryForm();
      showToast('Backup importado');
    } catch {
      alert('Arquivo de backup inválido.');
    }
  };
  reader.readAsText(file);
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
}
function roundMoney(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }
function formatDate(date) { return new Intl.DateTimeFormat('pt-BR').format(new Date(`${date}T12:00:00`)); }

// Navegação
for (const btn of document.querySelectorAll('.nav-btn')) btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
$('openExpenseFromList').addEventListener('click', () => switchScreen('add'));
$('editSalaryBtn').addEventListener('click', () => switchScreen('settings'));
$('prevMonth').addEventListener('click', () => { currentMonth = addMonths(currentMonth, -1); renderDashboard(); syncSalaryForm(); });
$('nextMonth').addEventListener('click', () => { currentMonth = addMonths(currentMonth, 1); renderDashboard(); syncSalaryForm(); });

// Formulários
$('expenseForm').addEventListener('submit', submitExpense);
$('salaryForm').addEventListener('submit', saveSalary);
document.querySelectorAll('.segment').forEach(btn => btn.addEventListener('click', () => {
  paymentType = btn.dataset.type;
  document.querySelectorAll('.segment').forEach(s => s.classList.toggle('active', s === btn));
  $('installmentFields').classList.toggle('hidden', paymentType !== 'parcelado');
  updateInstallmentPreview();
}));
['amount','installmentCount','installmentsPaid'].forEach(id => $(id).addEventListener('input', updateInstallmentPreview));

// Ações dinâmicas
document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-delete-expense]'); if (d) deleteExpense(d.dataset.deleteExpense);
  const p = e.target.closest('[data-delete-purchase]'); if (p) deletePurchase(p.dataset.deletePurchase);
  const n = e.target.closest('[data-next-paid]'); if (n) markNextPaid(n.dataset.nextPaid);
});

$('exportBtn').addEventListener('click', exportBackup);
$('importInput').addEventListener('change', e => e.target.files[0] && importBackup(e.target.files[0]));
$('clearBtn').addEventListener('click', () => {
  if (!confirm('Tem certeza? Isso apagará salário, gastos e parcelamentos deste aparelho.')) return;
  state.salaries = {}; state.expenses = []; state.purchases = []; saveState();
  renderDashboard(); renderInstallments(); syncSalaryForm(); showToast('Dados apagados');
});

// PWA
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredInstallPrompt = e; $('installBtn').classList.remove('hidden');
});
$('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('installBtn').classList.add('hidden');
});
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));

setDefaultDates();
syncSalaryForm();
renderDashboard();
renderInstallments();

/* ══════════════════════════════════════════
   PAISA — Core App Logic
   paisa-app.js
══════════════════════════════════════════ */

/* ── State ── */
let expenses    = JSON.parse(localStorage.getItem('paisa_expenses') || '[]');
let categories  = JSON.parse(localStorage.getItem('paisa_cats')     || 'null') || [
  {name:'Food',emoji:'🍔'},{name:'Groceries',emoji:'🛒'},
  {name:'Medicines',emoji:'💊'},{name:'Gasoline',emoji:'⛽'},
  {name:'Kid Items',emoji:'🧸'},{name:'Household',emoji:'🏠'},
  {name:'Clothes',emoji:'👕'},{name:'Gifts',emoji:'🎁'},
  {name:'Debts',emoji:'💸'},{name:'Transport',emoji:'🚗'},
  {name:'Entertainment',emoji:'🎬'},{name:'Subscriptions',emoji:'📱'},
  {name:'Education',emoji:'📚'},{name:'Healthcare',emoji:'🏥'},
  {name:'Travel',emoji:'✈️'},{name:'Other',emoji:'📦'}
];
let payMethods  = JSON.parse(localStorage.getItem('paisa_pays')  || 'null') || ['UPI','Cash','Credit Card','Debit Card','Bank Transfer'];
let budgets     = JSON.parse(localStorage.getItem('paisa_budgets')|| '{}');  // { catName: amount, _overall: amount }
let editingExpId= null;
let pendingImport=null;
let currentPage = 'dashboard';
let dashFrom    = null; // custom range start
let dashTo      = null; // custom range end

const COLORS = ['#00d4aa','#7c6af5','#f59e0b','#f87171','#10b981','#60a5fa','#e879f9','#fb923c','#34d399','#a78bfa','#fbbf24','#f472b6','#4ade80','#38bdf8','#c084fc','#fdba74'];
const fmt   = v => '₹'+Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
const genId = () => Date.now().toString(36)+Math.random().toString(36).slice(2);
const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const esc   = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const save  = () => {
  localStorage.setItem('paisa_expenses', JSON.stringify(expenses));
  localStorage.setItem('paisa_cats',     JSON.stringify(categories));
  localStorage.setItem('paisa_pays',     JSON.stringify(payMethods));
  localStorage.setItem('paisa_budgets',  JSON.stringify(budgets));
};

/* ── Date Range Helpers ── */
function currentDayRange(){
  const val = document.getElementById('day-range').value;
  if(val==='currentmonth'||val==='custom') return 30; // fallback for calcs that need a number
  return parseInt(val)||30;
}

function getDashRange(){
  if(dashFrom && dashTo) return { from: dashFrom, to: dashTo };
  const val = document.getElementById('day-range').value;
  if(val === 'currentmonth'){
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
    const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(lastDay).padStart(2,'0')}` };
  }
  const days = currentDayRange();
  const cut  = new Date(); cut.setDate(cut.getDate()-days);
  return { from: cut.toISOString().split('T')[0], to: today() };
}

function getDashData(){
  const {from,to} = getDashRange();
  return expenses.filter(e=>e.date>=from && e.date<=to);
}

/* ── Page Navigation ── */
function goPage(p){
  currentPage = p;
  document.querySelectorAll('.page').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.bnav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+p).classList.add('active');
  const nb=document.getElementById('nav-'+p); if(nb) nb.classList.add('active');
  const bnb=document.getElementById('bnav-'+p); if(bnb) bnb.classList.add('active');
  if(p==='dashboard') renderDashboard();
  if(p==='expenses'){
    const ff=document.getElementById('f-from'),ft=document.getElementById('f-to');
    if(!ff.value&&!ft.value){ ff.value=today(); ft.value=today(); }
    renderExpenses();
  }
  if(p==='monthly')  renderMonthly();
  if(p==='settings') renderSettings();
}

/* ── Custom date range toggle ── */
function onRangeChange(){
  const val = document.getElementById('day-range').value;
  const custom = document.getElementById('custom-range');
  if(val==='custom'){
    custom.classList.add('show');
  } else {
    custom.classList.remove('show');
    dashFrom=null; dashTo=null;
    renderDashboard();
  }
}
function applyCustomRange(){
  const f=document.getElementById('dash-from').value;
  const t=document.getElementById('dash-to').value;
  if(!f||!t){ showToast('⚠️','Select both From and To dates.'); return; }
  if(f>t){ showToast('⚠️','From date must be before To date.'); return; }
  dashFrom=f; dashTo=t;
  renderDashboard();
}

/* ── Recurring Auto-Entry ── */
function processRecurringExpenses(){
  const td = today();
  const alreadyProcessed = localStorage.getItem('paisa_recur_date') === td;
  if(alreadyProcessed) return;

  let added = 0;
  const recurExpenses = expenses.filter(e=>e.recurring && e.recurFreq);

  recurExpenses.forEach(template => {
    const origDate = new Date(template.date+'T00:00:00');
    const origDay  = origDate.getDate();
    const now      = new Date();
    const curYear  = now.getFullYear();
    const curMonth = now.getMonth();

    let shouldAddDate = null;

    if(template.recurFreq === 'monthly'){
      // Add on the same day of current month
      const daysInMonth = new Date(curYear, curMonth+1, 0).getDate();
      const targetDay   = Math.min(origDay, daysInMonth);
      const targetDate  = `${curYear}-${String(curMonth+1).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
      if(targetDate === td) shouldAddDate = td;
    } else if(template.recurFreq === 'weekly'){
      // Add on same weekday every week
      if(now.getDay() === origDate.getDay()) shouldAddDate = td;
    } else if(template.recurFreq === 'daily'){
      shouldAddDate = td;
    }

    if(shouldAddDate){
      // Check not already added today
      const alreadyToday = expenses.some(e =>
        e.recurSourceId === template.id && e.date === shouldAddDate
      );
      if(!alreadyToday){
        expenses.unshift({
          id: genId(),
          amount:    template.amount,
          category:  template.category,
          payment:   template.payment,
          date:      shouldAddDate,
          time:      template.time||'',
          notes:     template.notes||'',
          recurring: false,
          recurSourceId: template.id,
          autoAdded: true,
        });
        added++;
      }
    }
  });

  if(added > 0){
    save();
    showToast('🔁', `${added} recurring expense${added>1?'s':''} auto-added for today.`);
  }
  localStorage.setItem('paisa_recur_date', td);
}

/* ── Expense Modal ── */
document.getElementById('f-recurring').addEventListener('change', e=>{
  document.getElementById('recur-freq-row').style.display = e.target.checked?'block':'none';
});

function openAddExpense(){
  editingExpId=null;
  document.getElementById('exp-modal-title').textContent='Add Expense';
  document.getElementById('f-amount').value='';
  document.getElementById('f-date').value=today();
  document.getElementById('f-time').value=new Date().toTimeString().slice(0,5);
  document.getElementById('f-notes').value='';
  document.getElementById('f-recurring').checked=false;
  document.getElementById('recur-freq-row').style.display='none';
  populateCatSelect(); populatePaySelect();
  document.getElementById('expense-modal').classList.add('open');
  setTimeout(()=>document.getElementById('f-amount').focus(),120);
}

function openEditExpense(id){
  const e=expenses.find(x=>x.id===id); if(!e) return;
  editingExpId=id;
  document.getElementById('exp-modal-title').textContent='Edit Expense';
  document.getElementById('f-amount').value=e.amount;
  document.getElementById('f-date').value=e.date;
  document.getElementById('f-time').value=e.time||'';
  document.getElementById('f-notes').value=e.notes||'';
  document.getElementById('f-recurring').checked=!!e.recurring;
  document.getElementById('recur-freq-row').style.display=e.recurring?'block':'none';
  populateCatSelect(e.category); populatePaySelect(e.payment);
  if(e.recurring) document.getElementById('f-recur-freq').value=e.recurFreq||'monthly';
  document.getElementById('expense-modal').classList.add('open');
}

function closeExpenseModal(){ document.getElementById('expense-modal').classList.remove('open'); editingExpId=null; }

function populateCatSelect(sel){
  document.getElementById('f-category').innerHTML=categories.map(c=>`<option value="${c.name}"${c.name===sel?'selected':''}>${c.emoji} ${c.name}</option>`).join('');
}
function populatePaySelect(sel){
  document.getElementById('f-payment').innerHTML=payMethods.map(p=>`<option value="${p}"${p===sel?'selected':''}>${p}</option>`).join('');
}
function populateFilterSelects(){
  const s=document.getElementById('f-cat'); const cur=s.value;
  s.innerHTML='<option value="">All Categories</option>'+categories.map(c=>`<option value="${c.name}"${c.name===cur?'selected':''}>${c.emoji} ${c.name}</option>`).join('');
}

function saveExpense(){
  const amount=parseFloat(parseFloat(document.getElementById('f-amount').value).toFixed(2));
  if(!amount||amount<=0||isNaN(amount)){ showToast('⚠️','Please enter a valid amount.'); return; }
  const cat=document.getElementById('f-category').value;
  if(!cat){ showToast('⚠️','Please select a category.'); return; }
  const data={
    amount, category:cat,
    payment: document.getElementById('f-payment').value,
    date:    document.getElementById('f-date').value||today(),
    time:    document.getElementById('f-time').value,
    notes:   document.getElementById('f-notes').value.trim(),
    recurring: document.getElementById('f-recurring').checked,
    recurFreq: document.getElementById('f-recur-freq').value,
  };
  if(editingExpId){
    const idx=expenses.findIndex(e=>e.id===editingExpId);
    if(idx!==-1) expenses[idx]={...expenses[idx],...data};
    showToast('✓','Expense updated.');
  } else {
    expenses.unshift({id:genId(),...data});
    showToast('✓',`${fmt(amount)} added to ${cat}.`);
    // Budget alert
    checkBudgetAlert(cat, data.date);
  }
  save(); closeExpenseModal();
  if(currentPage==='dashboard') renderDashboard();
  else if(currentPage==='expenses') renderExpenses();
  else if(currentPage==='monthly') renderMonthly();
}

function deleteExpense(id){
  if(!confirm('Delete this expense?')) return;
  expenses=expenses.filter(e=>e.id!==id); save();
  if(currentPage==='dashboard') renderDashboard();
  else if(currentPage==='expenses') renderExpenses();
  else if(currentPage==='monthly') renderMonthly();
  showToast('🗑️','Expense deleted.');
}

/* ── Budget Alert ── */
function checkBudgetAlert(catName, dateStr){
  const monthKey = dateStr.slice(0,7);
  const curMonthKey = today().slice(0,7);
  if(monthKey !== curMonthKey) return;

  const budget = budgets[catName];
  if(!budget) return;

  const spent = expenses.filter(e=>e.category===catName && e.date.startsWith(curMonthKey)).reduce((s,e)=>s+e.amount,0);
  const pct   = spent/budget*100;

  if(pct>=100){
    showToast('🔴',`Over budget! ${catName}: ${fmt(spent)} of ${fmt(budget)} (${Math.round(pct)}%)`);
  } else if(pct>=90){
    showToast('🟠',`Almost over budget! ${catName}: ${Math.round(pct)}% used`);
  } else if(pct>=75){
    showToast('🟡',`Budget warning: ${catName} at ${Math.round(pct)}%`);
  }

  // Overall budget check
  const overallBudget = budgets['_overall'];
  if(overallBudget){
    const totalSpent = expenses.filter(e=>e.date.startsWith(curMonthKey)).reduce((s,e)=>s+e.amount,0);
    const opct = totalSpent/overallBudget*100;
    if(opct>=100 && Math.round(opct)===100) showToast('🔴',`Monthly budget exceeded! ${fmt(totalSpent)} of ${fmt(overallBudget)}`);
    else if(opct>=90 && opct<91) showToast('🟠',`Monthly budget at 90%! ${fmt(totalSpent)} of ${fmt(overallBudget)}`);
  }
}

/* ══════════════════════════════════════════
   DASHBOARD
══════════════════════════════════════════ */
function renderDashboard(){
  const {from,to} = getDashRange();
  const data = getDashData();

  const d1 = new Date(from+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  const d2 = new Date(to+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  document.getElementById('dash-date-sub').textContent=`${d1} — ${d2}`;

  const total = data.reduce((s,e)=>s+e.amount,0);
  const days  = Math.max(1, Math.round((new Date(to)-new Date(from))/86400000)+1);
  const avg   = total/days;

  const catTotals={}, payTotals={};
  data.forEach(e=>{
    catTotals[e.category]=(catTotals[e.category]||0)+e.amount;
    payTotals[e.payment]=(payTotals[e.payment]||0)+e.amount;
  });
  const sortedCats=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  const topCat=sortedCats[0];

  const todayData=expenses.filter(e=>e.date===today());
  const todayTotal=todayData.reduce((s,e)=>s+e.amount,0);

  // Spending trends
  const trends = calcTrends();

  // Stat cards
  document.getElementById('s-today').textContent=fmt(todayTotal);
  document.getElementById('s-today-sub').textContent=`${todayData.length} txn${todayData.length!==1?'s':''} today`;
  document.getElementById('s-total').textContent=fmt(total);
  document.getElementById('s-total-sub').textContent=`across ${data.length} transactions`;
  document.getElementById('s-avg').textContent=fmt(avg);
  document.getElementById('s-avg-sub').textContent=`over ${days} day${days!==1?'s':''}`;
  document.getElementById('s-topcat').textContent=topCat?`${getCatEmoji(topCat[0])} ${topCat[0]}`:'—';
  document.getElementById('s-topcat-sub').textContent=topCat?fmt(topCat[1]):'No data';
  document.getElementById('s-count').textContent=data.length;
  document.getElementById('s-count-sub').textContent=`${expenses.filter(e=>e.recurring).length} recurring`;

  // Trend pills
  renderTrendPill('trend-week-pill', trends.weekPct);
  renderTrendPill('trend-month-pill', trends.monthPct);

  drawBarChart(data, from, to, days);
  drawDonutChart(catTotals, total);
  drawPayChart(payTotals);
  renderBudgetSection();
  renderForecast();
  renderTrends(trends);
  renderTop5();
  renderHeatmap();
  renderInsights(data, catTotals, payTotals, days);
  renderRecent(data.slice().sort((a,b)=>b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||'')).slice(0,8));
}

function renderTrendPill(elId, pct){
  const el=document.getElementById(elId); if(!el) return;
  if(pct===null){ el.style.display='none'; return; }
  el.style.display='inline-flex';
  if(pct>5){ el.className='trend-pill trend-up'; el.textContent=`▲ ${Math.abs(pct).toFixed(0)}%`; }
  else if(pct<-5){ el.className='trend-pill trend-down'; el.textContent=`▼ ${Math.abs(pct).toFixed(0)}%`; }
  else { el.className='trend-pill trend-flat'; el.textContent='~ Stable'; }
}

/* ── Spending Trends ── */
function calcTrends(){
  const td=today();
  const now=new Date();

  // Week: this Mon–Sun vs last Mon–Sun
  const dow=(now.getDay()+6)%7; // Mon=0
  const thisMonStart=new Date(now); thisMonStart.setDate(now.getDate()-dow);
  const lastMonStart=new Date(thisMonStart); lastMonStart.setDate(thisMonStart.getDate()-7);
  const lastMonEnd=new Date(thisMonStart); lastMonEnd.setDate(thisMonStart.getDate()-1);
  const twStr=thisMonStart.toISOString().split('T')[0];
  const lwStr=lastMonStart.toISOString().split('T')[0];
  const lwEndStr=lastMonEnd.toISOString().split('T')[0];

  const thisWeekTotal=expenses.filter(e=>e.date>=twStr&&e.date<=td).reduce((s,e)=>s+e.amount,0);
  const lastWeekTotal=expenses.filter(e=>e.date>=lwStr&&e.date<=lwEndStr).reduce((s,e)=>s+e.amount,0);
  const weekPct = lastWeekTotal>0 ? ((thisWeekTotal-lastWeekTotal)/lastWeekTotal*100) : null;

  // Month: this month vs last month (prorated by days elapsed)
  const curMonKey=td.slice(0,7);
  const lastMonth=new Date(now.getFullYear(),now.getMonth()-1,1);
  const lastMonKey=lastMonth.toISOString().slice(0,7);
  const dayOfMonth=now.getDate();
  const daysLastMon=new Date(now.getFullYear(),now.getMonth(),0).getDate();
  const prorateDays=Math.min(dayOfMonth,daysLastMon);
  const lastMonEndProrate=`${lastMonKey}-${String(prorateDays).padStart(2,'0')}`;

  const thisMonTotal=expenses.filter(e=>e.date.startsWith(curMonKey)).reduce((s,e)=>s+e.amount,0);
  const lastMonTotal=expenses.filter(e=>e.date>=lastMonKey+'-01'&&e.date<=lastMonEndProrate).reduce((s,e)=>s+e.amount,0);
  const monthPct = lastMonTotal>0 ? ((thisMonTotal-lastMonTotal)/lastMonTotal*100) : null;

  return {weekPct, monthPct, thisWeekTotal, lastWeekTotal, thisMonTotal, lastMonTotal};
}

/* ── Render Spending Trends Card ── */
function renderTrends(trends){
  const el = document.getElementById('trends-detail'); if(!el) return;
  const now = new Date();
  const dow = (now.getDay()+6)%7;
  const thisMonStart = new Date(now); thisMonStart.setDate(now.getDate()-dow);
  const twStr = `${thisMonStart.getFullYear()}-${String(thisMonStart.getMonth()+1).padStart(2,'0')}-${String(thisMonStart.getDate()).padStart(2,'0')}`;
  const curMonKey = today().slice(0,7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const lastMonKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth()+1).padStart(2,'0')}`;
  const thisMonName = now.toLocaleDateString('en-IN',{month:'long'});
  const lastMonName = lastMonth.toLocaleDateString('en-IN',{month:'long'});

  function trendBlock(label, current, previous, pct, period1, period2){
    const hasData = previous > 0;
    const arrow   = !hasData ? '—' : pct > 5 ? '▲' : pct < -5 ? '▼' : '~';
    const color   = !hasData ? 'var(--text3)' : pct > 5 ? 'var(--danger)' : pct < -5 ? 'var(--success)' : 'var(--text3)';
    const msg     = !hasData ? 'No previous data to compare'
                  : pct > 5  ? `Spending up ${Math.abs(pct).toFixed(1)}% vs ${period2}`
                  : pct < -5 ? `Spending down ${Math.abs(pct).toFixed(1)}% vs ${period2}`
                  : `Stable — within 5% of ${period2}`;
    const barMaxW = Math.max(current, previous) || 1;
    const curW    = Math.round(current/barMaxW*100);
    const prevW   = Math.round(previous/barMaxW*100);
    return `
      <div style="background:var(--bg2);border-radius:var(--r);padding:14px 16px;margin-bottom:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px">${label}</div>
          <div style="font-size:13px;font-weight:700;color:${color}">${arrow} ${hasData?Math.abs(pct).toFixed(1)+'%':'—'}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div>
            <div style="font-size:10px;color:var(--text3);margin-bottom:3px">${period1}</div>
            <div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text1)">${fmt(current)}</div>
            <div style="margin-top:5px;height:4px;background:var(--bg3);border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${curW}%;background:var(--accent);border-radius:99px;transition:width .5s ease"></div>
            </div>
          </div>
          <div>
            <div style="font-size:10px;color:var(--text3);margin-bottom:3px">${period2}</div>
            <div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text3)">${fmt(previous)}</div>
            <div style="margin-top:5px;height:4px;background:var(--bg3);border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${prevW}%;background:var(--text3);border-radius:99px;transition:width .5s ease"></div>
            </div>
          </div>
        </div>
        <div style="font-size:11px;color:${color};display:flex;align-items:center;gap:5px">
          <span>${arrow !== '—' ? arrow : 'ℹ'}</span>
          <span>${msg}</span>
        </div>
      </div>`;
  }

  el.innerHTML =
    trendBlock('Week over Week',
      trends.thisWeekTotal, trends.lastWeekTotal, trends.weekPct,
      'This week', 'Last week') +
    trendBlock('Month over Month',
      trends.thisMonTotal, trends.lastMonTotal, trends.monthPct,
      thisMonName, lastMonName);
}

/* ── Budget Section ── */
function renderBudgetSection(){
  const el=document.getElementById('budget-section'); if(!el) return;
  const curMonKey=today().slice(0,7);

  const hasBudgets = Object.keys(budgets).length>0;
  if(!hasBudgets){ el.style.display='none'; return; }
  el.style.display='block';

  // Overall
  const overallBudget=budgets['_overall']||0;
  const totalSpent=expenses.filter(e=>e.date.startsWith(curMonKey)).reduce((s,e)=>s+e.amount,0);

  let overallHtml='';
  if(overallBudget>0){
    const pct=Math.min(totalSpent/overallBudget*100,150);
    const cls=pct>=100?'over':pct>=90?'alert':pct>=75?'warn':'ok';
    const lbl=pct>=100?'OVER BUDGET':pct>=90?'CRITICAL':pct>=75?'WARNING':'ON TRACK';
    overallHtml=`<div class="budget-overall-bar">
      <div class="budget-row-header" style="margin-bottom:8px">
        <span style="font-size:13px;font-weight:600">Monthly Overall Budget</span>
        <span class="budget-pct-label ${cls}">${lbl} · ${Math.round(pct)}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span class="budget-row-amounts">${fmt(totalSpent)} spent</span>
        <span class="budget-row-amounts">${fmt(overallBudget)} budget · ${fmt(Math.max(0,overallBudget-totalSpent))} left</span>
      </div>
      <div class="budget-track">
        <div class="budget-fill ${cls}" style="width:${Math.min(pct,100)}%"></div>
      </div>
    </div>`;
  }

  // Per-category
  const catBudgets=Object.entries(budgets).filter(([k])=>k!=='_overall').sort((a,b)=>b[1]-a[1]);
  const catRows=catBudgets.map(([catName,budget])=>{
    const spent=expenses.filter(e=>e.category===catName&&e.date.startsWith(curMonKey)).reduce((s,e)=>s+e.amount,0);
    const pct=budget>0?Math.min(spent/budget*100,150):0;
    const cls=pct>=100?'over':pct>=90?'alert':pct>=75?'warn':'ok';
    const over=spent>budget?`<span class="budget-over-badge">+${fmt(spent-budget)}</span>`:'';
    return `<div class="budget-row">
      <div class="budget-row-header">
        <span class="budget-row-name">${getCatEmoji(catName)} ${catName}</span>
        <div style="display:flex;align-items:center;gap:6px">
          ${over}
          <span class="budget-pct-label ${cls}">${Math.round(pct)}%</span>
          <span class="budget-row-amounts">${fmt(spent)} / ${fmt(budget)}</span>
        </div>
      </div>
      <div class="budget-track"><div class="budget-fill ${cls}" style="width:${Math.min(pct,100)}%"></div></div>
    </div>`;
  }).join('');

  document.getElementById('budget-bars').innerHTML=overallHtml+catRows;
}

/* ── Spending Forecast ── */
function renderForecast(){
  const el=document.getElementById('forecast-card'); if(!el) return;
  const now=new Date();
  const curMonKey=today().slice(0,7);
  const dayOfMonth=now.getDate();
  const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const daysLeft=daysInMonth-dayOfMonth;
  const monthlySpent=expenses.filter(e=>e.date.startsWith(curMonKey)).reduce((s,e)=>s+e.amount,0);
  const dailyAvg=dayOfMonth>0?monthlySpent/dayOfMonth:0;
  const projected=monthlySpent+dailyAvg*daysLeft;
  const monthName=now.toLocaleDateString('en-IN',{month:'long'});
  const spentPct=Math.min(dayOfMonth/daysInMonth*100,100);
  const projPct=Math.min(projected/(projected||1)*100,100);
  const overallBudget=budgets['_overall']||0;
  const budgetLine=overallBudget>0?`<div style="font-size:12px;color:var(--text3);margin-top:4px">Budget: ${fmt(overallBudget)} · ${projected>overallBudget?'<span style=color:var(--danger)>Will exceed by '+fmt(projected-overallBudget)+'</span>':'<span style=color:var(--success)>Within budget ✓</span>'}</div>`:'';

  el.innerHTML=`
    <div class="chart-card-header" style="margin-bottom:12px">
      <div class="chart-card-title">Spending Forecast</div>
      <div class="chart-card-sub">${monthName}</div>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Projected end-of-month total</div>
    <div class="forecast-number">${fmt(Math.round(projected))}</div>
    ${budgetLine}
    <div class="forecast-bar-track">
      <div class="forecast-bar-spent" style="width:${spentPct}%"></div>
      <div class="forecast-bar-proj" style="left:${spentPct}%;width:${100-spentPct}%;background:var(--accent2)"></div>
      <div class="forecast-marker" style="left:${spentPct}%"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3)">
      <span>Day ${dayOfMonth} · ${fmt(monthlySpent)} spent</span>
      <span>${daysLeft} days left</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Daily Avg This Month</div>
        <div style="font-family:var(--font-display);font-size:16px;font-weight:700">${fmt(dailyAvg)}</div>
      </div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:10px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Spent So Far</div>
        <div style="font-family:var(--font-display);font-size:16px;font-weight:700">${fmt(monthlySpent)}</div>
      </div>
    </div>`;
}

/* ── Top 5 ── */
function renderTop5(){
  const el=document.getElementById('top5-section'); if(!el) return;
  const {from,to}=getDashRange();
  const data=getDashData();

  // Top 5 transactions
  const topTxns=[...data].sort((a,b)=>b.amount-a.amount).slice(0,5);
  // Top 5 days
  const dayTotals={};
  data.forEach(e=>{dayTotals[e.date]=(dayTotals[e.date]||0)+e.amount;});
  const topDays=Object.entries(dayTotals).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const rankLabel=(i)=>{
    if(i===0) return '<span class="top5-rank gold">1</span>';
    if(i===1) return '<span class="top5-rank silver">2</span>';
    if(i===2) return '<span class="top5-rank bronze">3</span>';
    return `<span class="top5-rank">${i+1}</span>`;
  };

  const txnRows=topTxns.length?topTxns.map((e,i)=>`
    <div class="top5-row">
      ${rankLabel(i)}
      <div class="top5-info">
        <div class="top5-name">${esc(e.notes||e.category)}</div>
        <div class="top5-sub">${getCatEmoji(e.category)} ${e.category} · ${new Date(e.date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</div>
      </div>
      <div class="top5-amount">${fmt(e.amount)}</div>
    </div>`).join('')
    :'<div style="font-size:13px;color:var(--text3);padding:12px 0">No data for this period</div>';

  const dayRows=topDays.length?topDays.map(([date,amt],i)=>{
    const d=new Date(date+'T00:00:00');
    const cnt=data.filter(e=>e.date===date).length;
    return `<div class="top5-row">
      ${rankLabel(i)}
      <div class="top5-info">
        <div class="top5-name">${d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'long'})}</div>
        <div class="top5-sub">${cnt} transaction${cnt!==1?'s':''}</div>
      </div>
      <div class="top5-amount" style="cursor:pointer" onclick="openDayModal('${date}')">${fmt(amt)}</div>
    </div>`;}).join('')
    :'<div style="font-size:13px;color:var(--text3);padding:12px 0">No data for this period</div>';

  el.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="chart-card">
        <div class="chart-card-header" style="margin-bottom:14px">
          <div class="chart-card-title">🏆 Top 5 Transactions</div>
          <div class="chart-card-sub">Highest single expenses</div>
        </div>
        ${txnRows}
      </div>
      <div class="chart-card">
        <div class="chart-card-header" style="margin-bottom:14px">
          <div class="chart-card-title">📅 Top 5 Spending Days</div>
          <div class="chart-card-sub">Click amount to view day detail</div>
        </div>
        ${dayRows}
      </div>
    </div>`;
}

/* ── Heatmap ── */
function renderHeatmap(){
  const el=document.getElementById('heatmap-section'); if(!el) return;

  const now=new Date();
  const WEEKS=53;
  // Build day→amount map — normalize date keys defensively
  const dayMap={};
  expenses.forEach(e=>{
    if(!e.date) return;
    // Normalize: ensure format is YYYY-MM-DD with zero-padding
    const parts = e.date.split('-');
    if(parts.length !== 3) return;
    const normalized = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
    dayMap[normalized] = (dayMap[normalized]||0) + e.amount;
  });
  console.log('[Heatmap] dayMap keys:', Object.keys(dayMap));
  console.log('[Heatmap] Total days with data:', Object.keys(dayMap).length);
  const vals=Object.values(dayMap).filter(v=>v>0);
  const maxVal=vals.length?Math.max(...vals):1;
  const sortedVals=[...vals].sort((a,b)=>a-b);
  const p75=sortedVals.length?sortedVals[Math.floor(sortedVals.length*.75)]:maxVal;

  // Detect light mode for empty cell color
  const emptyColor = document.body.classList.contains('light') ? '#dde3ed' : '#252a35';
  // Use p75 as scale reference but ensure any spend > 0 always shows color
  function heatColor(amt){
    if(!amt || amt === 0) return emptyColor;
    const scale = p75 > 0 ? p75 : maxVal;
    const intensity = Math.min(amt / scale, 1);
    if(intensity < 0.2)  return '#0a4a36';
    if(intensity < 0.4)  return '#0f7a58';
    if(intensity < 0.6)  return '#14a87a';
    if(intensity < 0.8)  return '#10c98e';
    return '#00d4aa';
  }

  // Anchor grid so that TODAY is always visible in the last column.
  // Strategy: find the Monday of the week that is (WEEKS-1) weeks ago.
  // This gives us exactly WEEKS columns with today in the rightmost week.
  const todayStr = today();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Step 1: find Monday of the current week
  const todayDow = (todayMidnight.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const thisMonday = new Date(todayMidnight);
  thisMonday.setDate(thisMonday.getDate() - todayDow);

  // Step 2: go back (WEEKS-1) weeks from this Monday — that's our start
  const startDate = new Date(thisMonday);
  startDate.setDate(startDate.getDate() - (WEEKS - 1) * 7);

  const DAY_NAMES = ['M','','W','','F','','S'];
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build weeks array — compare date strings to avoid DST/time issues
  const weeks = [];
  const cur = new Date(startDate);
  const generatedDates = [];
  for(let w = 0; w < WEEKS; w++){
    const week = [];
    for(let d = 0; d < 7; d++){
      const y = cur.getFullYear();
      const m = String(cur.getMonth()+1).padStart(2,'0');
      const day = String(cur.getDate()).padStart(2,'0');
      const dateStr = `${y}-${m}-${day}`;
      const amt = dayMap[dateStr] || 0;
      week.push({
        date:   dateStr,
        amt:    amt,
        month:  cur.getMonth(),
        day:    cur.getDate(),
        future: dateStr > todayStr
      });
      if(amt > 0) generatedDates.push(dateStr);
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  console.log('[Heatmap] todayStr:', todayStr);
  console.log('[Heatmap] Dates with matching expenses in grid:', generatedDates);
  console.log('[Heatmap] Grid start date:', `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`);

  // Month labels
  let monthLabels='<div style="display:flex;gap:3px;margin-bottom:4px;padding-left:18px">';
  let lastMonth=-1;
  weeks.forEach((week,wi)=>{
    const m=week[0].month;
    if(m!==lastMonth){
      monthLabels+=`<div style="font-size:9px;color:var(--text3);font-family:var(--font-mono);width:12px;flex-shrink:0;overflow:visible;white-space:nowrap">${MONTH_NAMES[m]}</div>`;
      lastMonth=m;
    } else {
      monthLabels+=`<div style="width:12px;flex-shrink:0"></div>`;
    }
  });
  monthLabels+='</div>';

  // Day labels column
  const dayCol='<div style="display:flex;flex-direction:column;gap:3px;padding-top:0;margin-right:4px">'+
    DAY_NAMES.map(d=>`<div style="font-size:9px;color:var(--text3);font-family:var(--font-mono);height:12px;line-height:12px;width:14px">${d}</div>`).join('')+
  '</div>';

  // Week columns
  const weekCols=weeks.map(week=>{
    const days=week.map(day=>{
      const color=day.future?'transparent':heatColor(day.amt);
      const title=day.future?'':`${day.date}: ${day.amt>0?fmt(day.amt):'No expenses'}`;
      return `<div class="heatmap-day" style="background:${color};${day.future?'border:1px solid var(--border)':''}"
        title="${title}"
        ${day.amt>0&&!day.future?`onclick="openDayModal('${day.date}')"`:''}></div>`;
    }).join('');
    return `<div style="display:flex;flex-direction:column;gap:3px">${days}</div>`;
  }).join('');

  const legend=`<div class="heatmap-legend">
    <span>Less</span>
    <div class="heatmap-legend-squares">
      ${[emptyColor,'#0e3d2e','#1a6b50','#209e74','#00d4aa'].map(c=>`<div class="heatmap-legend-sq" style="background:${c}"></div>`).join('')}
    </div>
    <span>More</span>
  </div>`;

  el.innerHTML=`<div class="chart-card">
    <div class="chart-card-header" style="margin-bottom:12px">
      <div class="chart-card-title">📆 Spending Heatmap</div>
      <div class="chart-card-sub">Last 52 weeks · Click a day to view</div>
    </div>
    <div class="heatmap-wrap">
      ${monthLabels}
      <div style="display:flex;gap:0">
        ${dayCol}
        <div style="display:flex;gap:3px">${weekCols}</div>
      </div>
      ${legend}
    </div>
  </div>`;
}

/* ── Bar Chart ── */
function drawBarChart(data, from, to, days){
  const canvas=document.getElementById('bar-chart');
  if(!canvas) return;
  const dpr=window.devicePixelRatio||1;
  const W=Math.max(canvas.parentElement.offsetWidth||300, 200);
  const H=200;
  canvas.width=W*dpr; canvas.height=H*dpr;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,W,H);

  // Buckets
  const buckets={};
  const cur=new Date(from+'T00:00:00');
  const end=new Date(to+'T00:00:00');
  while(cur<=end){
    const k=`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    buckets[k]=0;
    cur.setDate(cur.getDate()+1);
  }
  data.forEach(e=>{ if(buckets[e.date]!==undefined) buckets[e.date]+=e.amount; });
  const keys=Object.keys(buckets), vals=keys.map(k=>buckets[k]);
  const maxV=Math.max(...vals,1);

  const pad={top:16,right:12,bottom:32,left:52};
  const cW=W-pad.left-pad.right, cH=H-pad.top-pad.bottom;
  const barW=Math.max(2,cW/keys.length-2);
  const barGap=(cW-barW*keys.length)/(keys.length+1);

  // Grid
  ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad.top+(cH/4)*i;
    ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.font=`10px ${getComputedStyle(document.body).getPropertyValue('--font-mono')||'monospace'}`;
    ctx.textAlign='right';
    const v=maxV*(1-i/4);
    ctx.fillText('₹'+(v>=1000?(v/1000).toFixed(1)+'k':Math.round(v)), pad.left-4, y+3);
  }

  const bars=[];
  vals.forEach((v,i)=>{
    const x=pad.left+barGap+i*(barW+barGap);
    const bH=v>0?Math.max(2,(v/maxV)*cH):0;
    const y=pad.top+cH-bH;
    bars.push({x,y,w:barW,h:bH,v,date:keys[i]});
    const grad=ctx.createLinearGradient(0,y,0,y+bH);
    grad.addColorStop(0,'rgba(0,212,170,0.9)');
    grad.addColorStop(1,'rgba(0,212,170,0.2)');
    ctx.fillStyle=v>0?grad:'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.roundRect(x,y,barW,Math.max(bH,2),2); ctx.fill();
  });

  const step=Math.ceil(keys.length/7);
  keys.forEach((k,i)=>{
    if(i%step!==0) return;
    const x=pad.left+barGap+i*(barW+barGap)+barW/2;
    ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='9px sans-serif'; ctx.textAlign='center';
    const d=new Date(k+'T00:00:00');
    ctx.fillText(d.toLocaleDateString('en-IN',{month:'short',day:'numeric'}),x,H-pad.bottom+14);
  });

  // Tooltip + click
  const tt=document.getElementById('chart-tooltip');
  canvas.onclick=e=>{
    const r=canvas.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top;
    const found=bars.find(b=>mx>=b.x&&mx<=b.x+b.w&&my>=pad.top&&my<=pad.top+cH);
    if(found){ tt.classList.remove('show'); openDayModal(found.date); }
  };
  canvas.style.cursor='pointer';
  let touchMoved=false;
  canvas.ontouchstart=()=>{ touchMoved=false; };
  canvas.ontouchmove=e=>{
    touchMoved=true; e.preventDefault();
    const r=canvas.getBoundingClientRect(),t=e.touches[0];
    const mx=t.clientX-r.left,my=t.clientY-r.top;
    const found=bars.find(b=>mx>=b.x&&mx<=b.x+b.w&&my>=pad.top&&my<=pad.top+cH);
    if(found){
      const d=new Date(found.date+'T00:00:00');
      document.getElementById('tt-label').textContent=d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
      document.getElementById('tt-value').textContent=fmt(found.v);
      tt.style.left=(t.clientX+12)+'px'; tt.style.top=(t.clientY-50)+'px';
      tt.classList.add('show');
    }
  };
  canvas.ontouchend=e=>{
    tt.classList.remove('show');
    if(!touchMoved){
      const r=canvas.getBoundingClientRect(),t=e.changedTouches[0];
      const mx=t.clientX-r.left,my=t.clientY-r.top;
      const found=bars.find(b=>mx>=b.x&&mx<=b.x+b.w&&my>=pad.top&&my<=pad.top+cH);
      if(found) openDayModal(found.date);
    }
  };
  canvas.onmousemove=e=>{
    const r=canvas.getBoundingClientRect();
    const mx=e.clientX-r.left,my=e.clientY-r.top;
    const found=bars.find(b=>mx>=b.x&&mx<=b.x+b.w&&my>=pad.top&&my<=pad.top+cH);
    if(found){
      const d=new Date(found.date+'T00:00:00');
      document.getElementById('tt-label').textContent=d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
      document.getElementById('tt-value').textContent=fmt(found.v);
      document.getElementById('tt-sub').textContent=found.v>0?'Click to view details':'No expenses';
      tt.style.left=(e.clientX+12)+'px'; tt.style.top=(e.clientY-40)+'px';
      tt.classList.add('show');
    } else tt.classList.remove('show');
  };
  canvas.onmouseleave=()=>tt.classList.remove('show');
}

/* ── Donut Chart ── */
function drawDonutChart(catTotals,total){
  const canvas=document.getElementById('donut-chart'); if(!canvas) return;
  const dpr=window.devicePixelRatio||1;
  canvas.width=160*dpr; canvas.height=160*dpr;
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr);
  const cx=80,cy=80,R=68,r=44;
  ctx.clearRect(0,0,160,160);
  document.getElementById('donut-center-val').textContent=fmt(total);
  const entries=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  const legend=document.getElementById('donut-legend');
  if(!entries.length){
    ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.fill();
    legend.innerHTML='<div style="font-size:12px;color:var(--text3)">No data</div>'; return;
  }
  const tt=document.getElementById('chart-tooltip');
  const slices=[]; let angle=-Math.PI/2;
  entries.forEach(([name,val],i)=>{
    const sweep=(val/total)*Math.PI*2;
    const color=COLORS[i%COLORS.length];
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R,angle,angle+sweep);
    ctx.fillStyle=color; ctx.fill();
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--bg1')||'#111318'; ctx.fill();
    slices.push({name,val,color,start:angle,sweep});
    angle+=sweep;
  });
  ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue('--bg1')||'#111318';
  ctx.lineWidth=2; slices.forEach(s=>{ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,R,s.start,s.start+0.01);ctx.stroke();});

  const days=currentDayRange();
  legend.innerHTML=entries.slice(0,7).map(([n,v],i)=>`
    <div class="legend-item" onclick="openCatModal('${n.replace(/'/g,"\\'")}',${days})" style="border-radius:6px;padding:3px 4px;transition:background .15s" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
      <div class="legend-dot" style="background:${COLORS[i%COLORS.length]}"></div>
      <span class="legend-name">${n}</span>
      <span class="legend-pct">${total>0?Math.round(v/total*100):0}%</span>
      <span style="font-size:10px;color:var(--text3);margin-left:2px">›</span>
    </div>`).join('');

  function getSliceAt(mx,my){
    const dist=Math.sqrt((mx-cx)**2+(my-cy)**2);
    if(dist<r||dist>R) return null;
    let a=Math.atan2(my-cy,mx-cx);
    if(a<-Math.PI/2) a+=Math.PI*2;
    return slices.find(s=>{ let e2=s.start+s.sweep,st=s.start; if(st<-Math.PI/2){st+=Math.PI*2;e2+=Math.PI*2;} return a>=st&&a<e2; });
  }
  canvas.onmousemove=e=>{
    const rect=canvas.getBoundingClientRect();
    const sl=getSliceAt(e.clientX-rect.left,e.clientY-rect.top);
    if(sl){
      canvas.style.cursor='pointer';
      document.getElementById('tt-label').textContent=sl.name;
      document.getElementById('tt-value').textContent=fmt(sl.val);
      document.getElementById('tt-sub').textContent=Math.round(sl.val/total*100)+'% — tap for details';
      tt.style.left=(e.clientX+12)+'px'; tt.style.top=(e.clientY-40)+'px';
      tt.classList.add('show'); return;
    }
    canvas.style.cursor='default'; tt.classList.remove('show');
  };
  canvas.onmouseleave=()=>{ tt.classList.remove('show'); canvas.style.cursor='default'; };
  canvas.onclick=e=>{
    const rect=canvas.getBoundingClientRect();
    const sl=getSliceAt(e.clientX-rect.left,e.clientY-rect.top);
    if(sl){ tt.classList.remove('show'); openCatModal(sl.name,days); }
  };
  let dtMoved=false;
  canvas.ontouchstart=()=>{ dtMoved=false; };
  canvas.ontouchmove=e=>{ dtMoved=true; };
  canvas.ontouchend=e=>{
    if(!dtMoved){
      const rect=canvas.getBoundingClientRect(),t=e.changedTouches[0];
      const sl=getSliceAt(t.clientX-rect.left,t.clientY-rect.top);
      if(sl) openCatModal(sl.name,days);
    }
  };
}

/* ── Payment Chart ── */
function drawPayChart(payTotals){
  const canvas=document.getElementById('pay-chart'); if(!canvas) return;
  const dpr=window.devicePixelRatio||1;
  const W=Math.max(canvas.parentElement.offsetWidth||300,200), H=160;
  canvas.width=W*dpr; canvas.height=H*dpr;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,W,H);
  const entries=Object.entries(payTotals).sort((a,b)=>b[1]-a[1]);
  if(!entries.length) return;
  const total=entries.reduce((s,[,v])=>s+v,0);
  const payColors={'UPI':'#00d4aa','Cash':'#f59e0b','Credit Card':'#7c6af5','Debit Card':'#60a5fa','Bank Transfer':'#10b981'};
  const pad={top:12,right:16,bottom:28,left:100};
  const cW=W-pad.left-pad.right, cH=H-pad.top-pad.bottom;
  const rowH=cH/entries.length, maxV=entries[0][1];
  const tt=document.getElementById('chart-tooltip');
  if(canvas._bars) canvas._bars=[];
  canvas._bars=[];
  entries.forEach(([name,val],i)=>{
    const barH=Math.min(rowH*0.55,20);
    const y=pad.top+i*rowH+(rowH-barH)/2;
    const bW=Math.max(2,(val/maxV)*cW);
    const color=payColors[name]||COLORS[i%COLORS.length];
    ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.font='11px sans-serif'; ctx.textAlign='right';
    ctx.fillText(name,pad.left-8,y+barH/2+4);
    ctx.fillStyle='rgba(255,255,255,0.04)'; ctx.beginPath(); ctx.roundRect(pad.left,y,cW,barH,3); ctx.fill();
    ctx.fillStyle=color+'cc'; ctx.beginPath(); ctx.roundRect(pad.left,y,bW,barH,3); ctx.fill();
    ctx.fillStyle=color; ctx.font='10px monospace'; ctx.textAlign='left';
    ctx.fillText(Math.round(val/total*100)+'%',pad.left+bW+5,y+barH/2+4);
    canvas._bars.push({x:pad.left,y,w:cW,h:barH,val,name,color});
  });
  canvas.onmousemove=e=>{
    const r=canvas.getBoundingClientRect();
    const mx=e.clientX-r.left,my=e.clientY-r.top;
    const found=(canvas._bars||[]).find(b=>mx>=b.x&&mx<=b.x+b.w&&my>=b.y&&my<=b.y+b.h);
    if(found){
      document.getElementById('tt-label').textContent=found.name;
      document.getElementById('tt-value').textContent=fmt(found.val);
      document.getElementById('tt-sub').textContent=Math.round(found.val/total*100)+'% of total';
      tt.style.left=(e.clientX+12)+'px'; tt.style.top=(e.clientY-40)+'px';
      tt.classList.add('show');
    } else tt.classList.remove('show');
  };
  canvas.onmouseleave=()=>tt.classList.remove('show');
}

/* ── Insights ── */
function renderInsights(data,catTotals,payTotals,days){
  const el=document.getElementById('insights-list'); if(!el) return;
  if(!data.length){ el.innerHTML='<div style="font-size:13px;color:var(--text3)">Add expenses to see insights.</div>'; return; }
  const sortedCats=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  const topCat=sortedCats[0];
  const topPay=Object.entries(payTotals).sort((a,b)=>b[1]-a[1])[0];
  const dayTotals={}; data.forEach(e=>{dayTotals[e.date]=(dayTotals[e.date]||0)+e.amount;});
  const topDay=Object.entries(dayTotals).sort((a,b)=>b[1]-a[1])[0];
  const recurAmt=data.filter(e=>e.recurring||e.recurSourceId).reduce((s,e)=>s+e.amount,0);
  const trends=calcTrends();
  const insights=[
    topCat&&{icon:'🏆',text:`<b>${topCat[0]}</b> is your biggest spend: <b>${fmt(topCat[1])}</b>`},
    topPay&&{icon:'💳',text:`Most used payment: <b>${topPay[0]}</b>`},
    topDay&&{icon:'📅',text:`Highest day: <b>${new Date(topDay[0]+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})}</b> — ${fmt(topDay[1])}`},
    recurAmt>0&&{icon:'🔁',text:`Recurring: <b>${fmt(recurAmt)}</b> in period`},
    trends.weekPct!==null&&{icon:trends.weekPct>0?'📈':'📉',text:`This week vs last: <b style="color:${trends.weekPct>0?'var(--danger)':'var(--success)'}">${trends.weekPct>0?'+':''}${trends.weekPct.toFixed(1)}%</b> ${fmt(trends.thisWeekTotal)} vs ${fmt(trends.lastWeekTotal)}`},
    trends.monthPct!==null&&{icon:'🗓️',text:`This month vs last (prorated): <b style="color:${trends.monthPct>0?'var(--danger)':'var(--success)'}">${trends.monthPct>0?'+':''}${trends.monthPct.toFixed(1)}%</b>`},
  ].filter(Boolean);
  el.innerHTML=insights.map(i=>`<div style="display:flex;align-items:flex-start;gap:10px;font-size:12px;color:var(--text2);line-height:1.5"><span style="flex-shrink:0;font-size:14px">${i.icon}</span><span>${i.text}</span></div>`).join('');
}

function renderRecent(list){
  const el=document.getElementById('recent-list'); if(!el) return;
  if(!list.length){ el.innerHTML='<div style="font-size:13px;color:var(--text3);padding:20px 0;text-align:center">No expenses yet. Tap ＋ to add.</div>'; return; }
  el.innerHTML=list.map(e=>expenseRowHTML(e)).join('');
}

function getCatEmoji(name){ const c=categories.find(x=>x.name===name); return c?c.emoji:'📦'; }
function getCatColor(name){ const i=categories.findIndex(x=>x.name===name); return i>=0?COLORS[i%COLORS.length]:'#4a5168'; }
function payBadgeClass(p){
  if(p==='UPI') return 'badge-upi';
  if(p==='Cash') return 'badge-cash';
  if(p==='Credit Card'||p==='Debit Card') return 'badge-card';
  if(p==='Bank Transfer') return 'badge-bank';
  return 'badge-upi';
}

function expenseRowHTML(e){
  const d=new Date(e.date+'T00:00:00');
  const dateStr=d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
  const color=getCatColor(e.category);
  return `<div class="expense-row">
    <div class="expense-cat-icon" style="background:${color}18;color:${color}">${getCatEmoji(e.category)}</div>
    <div class="expense-info">
      <div class="expense-name">${esc(e.notes||e.category)}</div>
      <div class="expense-meta">${dateStr}${e.time?' · '+e.time:''} &nbsp;
        <span class="badge ${payBadgeClass(e.payment)}">${e.payment}</span>
        ${e.recurring?'&nbsp;<span class="badge badge-recurring">🔁</span>':''}
        ${e.autoAdded?'&nbsp;<span class="badge" style="background:rgba(0,212,170,0.08);color:var(--accent)">auto</span>':''}
      </div>
    </div>
    <div class="expense-amount${e.recurring?' recurring':''}">${fmt(e.amount)}</div>
  </div>`;
}

/* ══════════════════════════════════════════
   EXPENSES PAGE
══════════════════════════════════════════ */
function renderExpenses(){
  populateFilterSelects();
  const search=document.getElementById('f-search').value.toLowerCase();
  const cat=document.getElementById('f-cat').value;
  const pay=document.getElementById('f-pay').value;
  const from=document.getElementById('f-from').value;
  const to=document.getElementById('f-to').value;
  const minA=parseFloat(document.getElementById('f-min').value)||0;
  const maxA=parseFloat(document.getElementById('f-max').value)||Infinity;
  let list=expenses.filter(e=>{
    if(cat&&e.category!==cat) return false;
    if(pay&&e.payment!==pay) return false;
    if(from&&e.date<from) return false;
    if(to&&e.date>to) return false;
    if(e.amount<minA||e.amount>maxA) return false;
    if(search&&!((e.notes||'').toLowerCase().includes(search)||e.category.toLowerCase().includes(search)||e.payment.toLowerCase().includes(search))) return false;
    return true;
  }).sort((a,b)=>b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||''));
  document.getElementById('exp-count-sub').textContent=`${list.length} of ${expenses.length} entries · Total: ${fmt(list.reduce((s,e)=>s+e.amount,0))}`;
  const container=document.getElementById('expenses-list');
  if(!list.length){ container.innerHTML=`<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No results</div><div class="empty-sub">Try adjusting your filters.</div></div>`; return; }
  container.innerHTML=list.map(e=>{
    const d=new Date(e.date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'});
    const color=getCatColor(e.category);
    return `<div class="expense-table-row">
      <div class="col-name">
        <div class="expense-cat-icon" style="background:${color}18;color:${color};width:30px;height:30px;border-radius:8px;flex-shrink:0">${getCatEmoji(e.category)}</div>
        <div class="col-name-text">
          <div class="col-name-title">${esc(e.notes||e.category)}</div>
          <div class="col-name-note">${e.recurring?'🔁 Recurring':e.autoAdded?'🤖 Auto-added':''}</div>
        </div>
      </div>
      <div class="col-cat">${e.category}</div>
      <div class="col-amount" style="color:${color}">${fmt(e.amount)}</div>
      <div class="col-date">${d}</div>
      <div class="col-pay"><span class="badge ${payBadgeClass(e.payment)}">${e.payment}</span></div>
      <div class="col-actions">
        <button class="btn-icon-sm" title="Edit" onclick="openEditExpense('${e.id}')" style="width:28px;height:28px;font-size:13px">✏️</button>
        <button class="btn-icon-sm" title="Delete" onclick="deleteExpense('${e.id}')" style="width:28px;height:28px;font-size:13px">🗑</button>
      </div>
    </div>`;
  }).join('');
}
function clearFilters(){
  ['f-search','f-cat','f-pay','f-from','f-to','f-min','f-max'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  renderExpenses();
}

/* ══════════════════════════════════════════
   MONTHLY SUMMARY
══════════════════════════════════════════ */
function renderMonthly(){
  const byMonth={};
  expenses.forEach(e=>{
    const key=e.date.slice(0,7);
    if(!byMonth[key]) byMonth[key]={total:0,count:0,cats:{},days:{},pays:{}};
    byMonth[key].total+=e.amount; byMonth[key].count++;
    byMonth[key].cats[e.category]=(byMonth[key].cats[e.category]||0)+e.amount;
    byMonth[key].days[e.date]=(byMonth[key].days[e.date]||0)+e.amount;
    byMonth[key].pays[e.payment]=(byMonth[key].pays[e.payment]||0)+e.amount;
  });
  const months=Object.keys(byMonth).sort((a,b)=>b.localeCompare(a));
  const grid=document.getElementById('month-grid');
  if(!months.length){
    grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📅</div><div class="empty-title">No data yet</div><div class="empty-sub">Add expenses to see monthly summaries.</div></div>`;
    document.getElementById('month-detail').style.display='none'; return;
  }
  grid.innerHTML=months.map(m=>{
    const d=new Date(m+'-01');
    const label=d.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
    const md=byMonth[m];
    const topCat=Object.entries(md.cats).sort((a,b)=>b[1]-a[1])[0];
    const daysWithSpend=Object.keys(md.days).length;
    return `<div class="month-card" id="mc-${m}" onclick="showMonthDetail('${m}')">
      <div class="month-name">${label}</div>
      <div class="month-total">${fmt(md.total)}</div>
      <div class="month-stats">
        <span class="month-stat">${md.count} txns</span>
        <span class="month-stat">₹${Math.round(md.total/daysWithSpend).toLocaleString('en-IN')}/day</span>
        ${topCat?`<span class="month-stat">Top: ${topCat[0]}</span>`:''}
      </div>
    </div>`;
  }).join('');
  if(months.length) showMonthDetail(months[0]);
}

function showMonthDetail(key){
  document.querySelectorAll('.month-card').forEach(c=>c.classList.remove('selected'));
  const mc=document.getElementById('mc-'+key); if(mc) mc.classList.add('selected');
  const md={total:0,count:0,cats:{},days:{},pays:{}};
  expenses.filter(e=>e.date.startsWith(key)).forEach(e=>{
    md.total+=e.amount; md.count++;
    md.cats[e.category]=(md.cats[e.category]||0)+e.amount;
    md.days[e.date]=(md.days[e.date]||0)+e.amount;
    md.pays[e.payment]=(md.pays[e.payment]||0)+e.amount;
  });
  const d=new Date(key+'-01');
  const label=d.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  const sortedCats=Object.entries(md.cats).sort((a,b)=>b[1]-a[1]);
  const topDay=Object.entries(md.days).sort((a,b)=>b[1]-a[1])[0];
  const daysWithSpend=Object.keys(md.days).length;
  const topPay=Object.entries(md.pays).sort((a,b)=>b[1]-a[1])[0];
  const detail=document.getElementById('month-detail');
  detail.style.display='block';
  detail.innerHTML=`<div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:8px">
      <div style="font-family:var(--font-display);font-size:18px;font-weight:700">${label}</div>
      <div style="font-family:var(--font-display);font-size:24px;font-weight:700;color:var(--accent)">${fmt(md.total)}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
      <div style="background:var(--bg2);border-radius:var(--r);padding:12px"><div style="font-size:10px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Transactions</div><div style="font-family:var(--font-display);font-size:20px;font-weight:700">${md.count}</div></div>
      <div style="background:var(--bg2);border-radius:var(--r);padding:12px"><div style="font-size:10px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Daily Avg</div><div style="font-family:var(--font-display);font-size:20px;font-weight:700">${fmt(daysWithSpend?md.total/daysWithSpend:0)}</div></div>
      ${topDay?`<div style="background:var(--bg2);border-radius:var(--r);padding:12px"><div style="font-size:10px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Highest Day</div><div style="font-family:var(--font-display);font-size:14px;font-weight:700">${new Date(topDay[0]+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</div><div style="font-size:12px;color:var(--accent);font-family:var(--font-mono)">${fmt(topDay[1])}</div></div>`:''}
      ${topPay?`<div style="background:var(--bg2);border-radius:var(--r);padding:12px"><div style="font-size:10px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--text3);margin-bottom:6px">Top Payment</div><div style="font-family:var(--font-display);font-size:14px;font-weight:700">${topPay[0]}</div></div>`:''}
    </div>
    <div style="font-size:13px;font-weight:600;margin-bottom:12px">Category Breakdown</div>
    <div class="cat-breakdown">
      ${sortedCats.map(([n,v],i)=>`<div class="cat-bar-row"><div class="cat-bar-header"><div class="cat-bar-name">${getCatEmoji(n)} ${n}</div><div class="cat-bar-val">${fmt(v)} <span style="color:var(--text3)">${Math.round(v/md.total*100)}%</span></div></div><div class="cat-bar-track"><div class="cat-bar-fill" style="width:${v/md.total*100}%;background:${COLORS[i%COLORS.length]}"></div></div></div>`).join('')}
    </div>
  </div>`;
  detail.scrollIntoView({behavior:'smooth',block:'nearest'});
}

/* ══════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════ */
function renderSettings(){
  // Categories
  const cl=document.getElementById('cat-chip-list');
  cl.innerHTML=categories.map((c,i)=>`
    <div class="chip" draggable="true" data-index="${i}" style="border-color:${COLORS[i%COLORS.length]}40;cursor:grab"
      ondragstart="catDragStart(event,${i})" ondragover="catDragOver(event)" ondragleave="catDragLeave(event)"
      ondrop="catDrop(event,${i})" ondragend="catDragEnd(event)">
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <span>${c.emoji}</span><span>${c.name}</span>
      <button class="chip-remove" onclick="removeCategory(${i})">×</button>
    </div>`).join('');

  // Pay methods
  const pl=document.getElementById('pay-chip-list');
  pl.innerHTML=payMethods.map((p,i)=>`<div class="chip"><span>${p}</span><button class="chip-remove" onclick="removePayMethod(${i})">×</button></div>`).join('');

  // Budget inputs
  renderBudgetInputs();
  updateLastBackup();
}

function renderBudgetInputs(){
  const el=document.getElementById('budget-inputs'); if(!el) return;
  const overallVal=budgets['_overall']||'';
  let html=`<div class="budget-input-row" style="margin-bottom:8px;padding-bottom:12px;border-bottom:2px solid var(--border)">
    <span class="budget-cat-label" style="font-weight:600">💰 Monthly Overall Budget</span>
    <input class="budget-amt-input" type="number" placeholder="No limit" value="${overallVal}"
      onchange="saveBudget('_overall',this.value)" min="0"/>
  </div>`;
  html+=categories.map(c=>{
    const val=budgets[c.name]||'';
    return `<div class="budget-input-row">
      <span class="budget-cat-label">${c.emoji} ${c.name}</span>
      <input class="budget-amt-input" type="number" placeholder="No limit" value="${val}"
        onchange="saveBudget('${c.name.replace(/'/g,"\\'")}',this.value)" min="0"/>
    </div>`;
  }).join('');
  el.innerHTML=html;
}

function saveBudget(key,val){
  const num=parseFloat(val);
  if(!val||isNaN(num)||num<=0){ delete budgets[key]; }
  else { budgets[key]=num; }
  save();
  if(currentPage==='dashboard') renderBudgetSection();
  showToast('✓','Budget updated.');
}

let catDragIdx=null;
function catDragStart(e,i){ catDragIdx=i; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',i); setTimeout(()=>e.target.classList.add('dragging'),0); }
function catDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; e.currentTarget.classList.add('drag-over'); }
function catDragLeave(e){ e.currentTarget.classList.remove('drag-over'); }
function catDrop(e,toIdx){ e.preventDefault(); e.currentTarget.classList.remove('drag-over'); if(catDragIdx===null||catDragIdx===toIdx) return; const moved=categories.splice(catDragIdx,1)[0]; categories.splice(toIdx,0,moved); catDragIdx=null; save(); renderSettings(); showToast('✓','Category order updated.'); }
function catDragEnd(e){ e.target.classList.remove('dragging'); document.querySelectorAll('.chip').forEach(c=>c.classList.remove('drag-over')); catDragIdx=null; }

function addCategory(){ const name=document.getElementById('cat-name-input').value.trim(); const emoji=document.getElementById('cat-emoji').value.trim()||'📦'; if(!name){ showToast('⚠️','Enter a category name.'); return; } if(categories.find(c=>c.name.toLowerCase()===name.toLowerCase())){ showToast('⚠️','Category already exists.'); return; } categories.push({name,emoji}); document.getElementById('cat-name-input').value=''; document.getElementById('cat-emoji').value=''; save(); renderSettings(); showToast('✓',`"${name}" added.`); }
function removeCategory(i){ if(!confirm(`Remove "${categories[i].name}"?`)) return; categories.splice(i,1); save(); renderSettings(); }
function addPayMethod(){ const name=document.getElementById('pay-name-input').value.trim(); if(!name){ showToast('⚠️','Enter a payment method name.'); return; } if(payMethods.includes(name)){ showToast('⚠️','Already exists.'); return; } payMethods.push(name); document.getElementById('pay-name-input').value=''; save(); renderSettings(); showToast('✓',`"${name}" added.`); }
function removePayMethod(i){ if(!confirm(`Remove "${payMethods[i]}"?`)) return; payMethods.splice(i,1); save(); renderSettings(); }

/* ══════════════════════════════════════════
   EXPORT / IMPORT / RESET
══════════════════════════════════════════ */
function toggleExportMenu(e){ e.stopPropagation(); const m=document.getElementById('export-menu'); m.style.display=m.style.display==='none'?'block':'none'; }
function closeExportMenu(){ const m=document.getElementById('export-menu'); if(m) m.style.display='none'; }
document.addEventListener('click',()=>closeExportMenu());

function exportData(){
  const payload={version:'2.0',exportedAt:new Date().toISOString(),app:'Paisa',expenses,categories,payMethods,budgets};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`paisa-backup-${today()}.json`; a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem('paisa_last_bk',new Date().toISOString());
  updateLastBackup(); showToast('⬇️',`Backup saved: paisa-backup-${today()}.json`);
}

function openImportModal(){ pendingImport=null; document.getElementById('dz-title').textContent='Click or drag & drop'; const prev=document.getElementById('import-preview'); prev.classList.remove('show'); prev.textContent=''; document.getElementById('bk-file').value=''; const btn=document.getElementById('bk-confirm-btn'); btn.disabled=true; btn.style.opacity='.4'; btn.style.cursor='not-allowed'; document.getElementById('import-modal').classList.add('open'); }
function closeImportModal(){ document.getElementById('import-modal').classList.remove('open'); pendingImport=null; }
function dzOver(e){ e.preventDefault(); document.getElementById('drop-zone').classList.add('drag-over'); }
function dzLeave(){ document.getElementById('drop-zone').classList.remove('drag-over'); }
function dzDrop(e){ e.preventDefault(); dzLeave(); if(e.dataTransfer.files[0]) parseBkFile(e.dataTransfer.files[0]); }
function bkFileSelect(e){ if(e.target.files[0]) parseBkFile(e.target.files[0]); }
function parseBkFile(file){
  if(!file.name.endsWith('.json')){ showToast('⚠️','Select a valid .json backup.'); return; }
  const r=new FileReader();
  r.onload=e=>{ try{ const data=JSON.parse(e.target.result); if(!data.expenses||!Array.isArray(data.expenses)) throw new Error(); pendingImport=data; const prev=document.getElementById('import-preview'); prev.textContent=`File: ${file.name}\nExported: ${data.exportedAt?new Date(data.exportedAt).toLocaleString():'Unknown'}\nExpenses: ${data.expenses.length}`; prev.classList.add('show'); document.getElementById('dz-title').textContent=`✓ ${file.name} ready`; const btn=document.getElementById('bk-confirm-btn'); btn.disabled=false; btn.style.opacity='1'; btn.style.cursor='pointer'; } catch{ showToast('⚠️','Invalid backup file.'); } };
  r.readAsText(file);
}
function confirmImport(){
  if(!pendingImport) return;
  const eIds=new Set(expenses.map(e=>e.id));
  expenses=[...(pendingImport.expenses||[]).filter(e=>!eIds.has(e.id)),...expenses];
  if(pendingImport.categories) categories=[...new Map([...categories,...pendingImport.categories].map(c=>[c.name,c])).values()];
  if(pendingImport.payMethods) payMethods=[...new Set([...payMethods,...(pendingImport.payMethods||[])])];
  if(pendingImport.budgets) budgets={...pendingImport.budgets,...budgets};
  save(); closeImportModal(); goPage(currentPage);
  showToast('✅',`Imported ${pendingImport.expenses.length} expenses!`);
}
function resetAllData(){ if(!confirm('⚠️ Permanently delete ALL expense data?\n\nThis cannot be undone.')) return; expenses=[]; budgets={}; localStorage.removeItem('paisa_last_bk'); localStorage.removeItem('paisa_recur_date'); save(); goPage('dashboard'); showToast('🗑️','All data reset.'); }
function updateLastBackup(){ const raw=localStorage.getItem('paisa_last_bk'); const el=document.getElementById('last-bk-display'); const txt=document.getElementById('last-bk-text'); if(!el) return; if(!raw){ el.className='last-bk'; txt.textContent='Never backed up'; return; } const diff=Math.floor((Date.now()-new Date(raw).getTime())/86400000); const d=new Date(raw); const lbl=diff===0?'Today at '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):diff===1?'Yesterday':`${diff} days ago`; el.className='last-bk'+(diff<=1?' ok':''); txt.textContent='Last backup: '+lbl; }

/* ══════════════════════════════════════════
   DAY DETAIL MODAL
══════════════════════════════════════════ */
function openDayModal(dateStr){
  const dayExp=expenses.filter(e=>e.date===dateStr).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
  const d=new Date(dateStr+'T00:00:00');
  const total=dayExp.reduce((s,e)=>s+e.amount,0);
  document.getElementById('day-modal-title').textContent=d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  document.getElementById('day-modal-sub').textContent=d.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('day-modal-add').dataset.date=dateStr;
  const avgTxn=dayExp.length?total/dayExp.length:0;
  document.getElementById('day-modal-stats').innerHTML=`
    <div class="day-stat-cell"><div class="day-stat-val">${fmt(total)}</div><div class="day-stat-lbl">Total Spent</div></div>
    <div class="day-stat-cell"><div class="day-stat-val">${dayExp.length}</div><div class="day-stat-lbl">Transactions</div></div>
    <div class="day-stat-cell"><div class="day-stat-val">${fmt(avgTxn)}</div><div class="day-stat-lbl">Avg / Txn</div></div>`;
  const catTotals={};
  dayExp.forEach(e=>{catTotals[e.category]=(catTotals[e.category]||0)+e.amount;});
  const sortedCats=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  document.getElementById('day-modal-cats').innerHTML=sortedCats.length?`
    <div style="font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--text3);margin-bottom:10px">Category Breakdown</div>
    ${sortedCats.map(([n,v],i)=>`<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-size:12px;color:var(--text1)">${getCatEmoji(n)} ${n}</span><span style="font-size:11px;font-family:var(--font-mono);color:var(--text2)">${fmt(v)} <span style="color:var(--text3)">${Math.round(v/total*100)}%</span></span></div><div style="height:4px;background:var(--bg3);border-radius:99px;overflow:hidden"><div style="height:100%;width:${v/total*100}%;background:${COLORS[i%COLORS.length]};border-radius:99px"></div></div></div>`).join('')}`
    :'<div style="font-size:13px;color:var(--text3);text-align:center;padding:8px 0">No expenses this day</div>';
  const listEl=document.getElementById('day-modal-list');
  if(!dayExp.length){
    listEl.innerHTML=`<div style="text-align:center;padding:24px 0;color:var(--text3);font-size:13px">No expenses.<br/><button onclick="addExpenseForDay()" style="margin-top:10px;background:rgba(0,212,170,0.1);border:1px solid rgba(0,212,170,0.3);border-radius:8px;color:var(--accent);font-size:12px;padding:7px 16px;cursor:pointer;font-family:inherit">＋ Add one</button></div>`;
  } else {
    listEl.innerHTML=`<div style="font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--text3);padding-top:14px;margin-bottom:8px">Expenses</div>`+
    dayExp.map(e=>{
      const color=getCatColor(e.category);
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="width:32px;height:32px;border-radius:8px;background:${color}18;color:${color};display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${getCatEmoji(e.category)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.notes||e.category)}</div>
          <div style="font-size:11px;color:var(--text3);font-family:var(--font-mono);margin-top:1px">${e.time||''}${e.time?' · ':''}<span class="badge ${payBadgeClass(e.payment)}">${e.payment}</span>${e.recurring?'<span class="badge badge-recurring" style="margin-left:4px">🔁</span>':''}${e.autoAdded?'<span class="badge" style="margin-left:4px;background:rgba(0,212,170,0.08);color:var(--accent)">auto</span>':''}</div>
        </div>
        <div style="font-family:var(--font-display);font-size:14px;font-weight:600;color:${color};flex-shrink:0">${fmt(e.amount)}</div>
        <div style="display:flex;gap:3px;flex-shrink:0">
          <button class="btn-icon-sm" style="width:26px;height:26px;font-size:12px" onclick="closeDayModal();openEditExpense('${e.id}')">✏️</button>
          <button class="btn-icon-sm" style="width:26px;height:26px;font-size:12px" onclick="deleteExpenseFromDay('${e.id}','${dateStr}')">🗑</button>
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('day-modal').classList.add('open');
}
function closeDayModal(){ document.getElementById('day-modal').classList.remove('open'); }
function addExpenseForDay(){ const dateStr=document.getElementById('day-modal-add').dataset.date||today(); closeDayModal(); openAddExpense(); setTimeout(()=>{ document.getElementById('f-date').value=dateStr; },50); }
function deleteExpenseFromDay(id,dateStr){ if(!confirm('Delete this expense?')) return; expenses=expenses.filter(e=>e.id!==id); save(); showToast('🗑️','Expense deleted.'); if(currentPage==='dashboard') renderDashboard(); openDayModal(dateStr); }

/* ══════════════════════════════════════════
   CATEGORY DETAIL MODAL
══════════════════════════════════════════ */
function openCatModal(catName,days){
  const {from,to}=getDashRange();
  const catExp=expenses.filter(e=>e.category===catName&&e.date>=from&&e.date<=to).sort((a,b)=>b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||''));
  const total=catExp.reduce((s,e)=>s+e.amount,0);
  const emoji=getCatEmoji(catName), color=getCatColor(catName);
  document.getElementById('cat-modal-title').textContent=`${emoji} ${catName}`;
  document.getElementById('cat-modal-sub').textContent=`${from} → ${to} · ${catExp.length} transaction${catExp.length!==1?'s':''}`;
  const avgTxn=catExp.length?total/catExp.length:0;
  document.getElementById('cat-modal-stats').innerHTML=`
    <div class="day-stat-cell"><div class="day-stat-val" style="color:${color}">${fmt(total)}</div><div class="day-stat-lbl">Total Spent</div></div>
    <div class="day-stat-cell"><div class="day-stat-val">${catExp.length}</div><div class="day-stat-lbl">Transactions</div></div>
    <div class="day-stat-cell"><div class="day-stat-val">${fmt(avgTxn)}</div><div class="day-stat-lbl">Avg / Txn</div></div>`;
  const listEl=document.getElementById('cat-modal-list');
  if(!catExp.length){ listEl.innerHTML=`<div style="text-align:center;padding:32px 0;color:var(--text3);font-size:13px">No expenses in <b>${catName}</b> for this period.</div>`; }
  else {
    const byDate={};
    catExp.forEach(e=>{ if(!byDate[e.date]) byDate[e.date]=[]; byDate[e.date].push(e); });
    listEl.innerHTML=Object.keys(byDate).sort((a,b)=>b.localeCompare(a)).map(dateStr=>{
      const d=new Date(dateStr+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
      const dayTotal=byDate[dateStr].reduce((s,e)=>s+e.amount,0);
      return `<div style="margin-bottom:4px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 6px;position:sticky;top:0;background:var(--bg1);z-index:1">
          <span style="font-size:11px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--text3)">${d}</span>
          <span style="font-size:12px;font-family:var(--font-mono);color:var(--text2)">${fmt(dayTotal)}</span>
        </div>
        ${byDate[dateStr].map(e=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.notes)||`<span style="color:var(--text3)">${esc(e.category)}</span>`}</div>
          <div style="font-size:11px;color:var(--text3);font-family:var(--font-mono);margin-top:2px;display:flex;align-items:center;gap:6px">${e.time?`<span>${e.time}</span>`:''}<span class="badge ${payBadgeClass(e.payment)}">${e.payment}</span>${e.recurring?'<span class="badge badge-recurring">🔁</span>':''}</div></div>
          <div style="font-family:var(--font-display);font-size:14px;font-weight:600;color:${color};flex-shrink:0">${fmt(e.amount)}</div>
          <div style="display:flex;gap:3px;flex-shrink:0">
            <button class="btn-icon-sm" style="width:26px;height:26px;font-size:12px" onclick="closeCatModal();openEditExpense('${e.id}')">✏️</button>
            <button class="btn-icon-sm" style="width:26px;height:26px;font-size:12px" onclick="deleteCatExpense('${e.id}','${esc(catName)}',${days})">🗑</button>
          </div></div>`).join('')}
      </div>`;
    }).join('');
  }
  document.getElementById('cat-modal').classList.add('open');
}
function closeCatModal(){ document.getElementById('cat-modal').classList.remove('open'); }
function deleteCatExpense(id,catName,days){ if(!confirm('Delete this expense?')) return; expenses=expenses.filter(e=>e.id!==id); save(); showToast('🗑️','Expense deleted.'); if(currentPage==='dashboard') renderDashboard(); openCatModal(catName,days); }

/* ══════════════════════════════════════════
   DARK / LIGHT MODE
══════════════════════════════════════════ */
function initTheme(){
  const saved=localStorage.getItem('paisa_theme')||'dark';
  applyTheme(saved);
}
function toggleTheme(){
  const isLight=document.body.classList.contains('light');
  applyTheme(isLight?'dark':'light');
}
function applyTheme(theme){
  if(theme==='light'){
    document.body.classList.add('light');
    const btn=document.getElementById('theme-btn'); if(btn) btn.textContent='☀️';
  } else {
    document.body.classList.remove('light');
    const btn=document.getElementById('theme-btn'); if(btn) btn.textContent='🌙';
  }
  localStorage.setItem('paisa_theme',theme);
  // Redraw charts on theme switch (colors need to update)
  if(currentPage==='dashboard') setTimeout(renderDashboard,50);
}

/* ══════════════════════════════════════════
   PIN LOCK
══════════════════════════════════════════ */
let pinBuffer='';
let pinMode='check'; // 'check' | 'set' | 'confirm'
let pinSetFirst='';

function initPinLock(){
  const storedPin=localStorage.getItem('paisa_pin');
  if(!storedPin){ hidePinScreen(); return; }
  showPinScreen('check');
}

function showPinScreen(mode){
  pinMode=mode; pinBuffer=''; pinSetFirst='';
  const screen=document.getElementById('pin-screen'); if(!screen) return;
  screen.style.display='flex';
  document.getElementById('pin-sub').textContent=
    mode==='set'?'Set a new 4-digit PIN':
    mode==='confirm'?'Confirm your PIN':
    'Enter your PIN to continue';
  updatePinDots();
  document.getElementById('pin-error').textContent='';
}
function hidePinScreen(){
  const screen=document.getElementById('pin-screen'); if(screen) screen.style.display='none';
}
function updatePinDots(){
  document.querySelectorAll('.pin-dot').forEach((d,i)=>{
    d.classList.toggle('filled',i<pinBuffer.length);
    d.classList.remove('error');
  });
}
function pinKey(val){
  if(pinBuffer.length>=4) return;
  pinBuffer+=val;
  updatePinDots();
  if(pinBuffer.length===4) setTimeout(processPinInput,120);
}
function pinBackspace(){
  if(pinBuffer.length>0){ pinBuffer=pinBuffer.slice(0,-1); updatePinDots(); }
}
function processPinInput(){
  const storedHash=localStorage.getItem('paisa_pin');
  const inputHash=simpleHash(pinBuffer);
  if(pinMode==='check'){
    if(inputHash===storedHash){ hidePinScreen(); showToast('🔓','Unlocked!'); }
    else { pinError('Incorrect PIN. Try again.'); }
  } else if(pinMode==='set'){
    pinSetFirst=pinBuffer; pinBuffer='';
    updatePinDots();
    document.getElementById('pin-sub').textContent='Confirm your new PIN';
    document.getElementById('pin-error').textContent='';
    pinMode='confirm';
  } else if(pinMode==='confirm'){
    if(pinBuffer===pinSetFirst){
      localStorage.setItem('paisa_pin',simpleHash(pinBuffer));
      hidePinScreen(); showToast('🔒','PIN set successfully!');
    } else { pinError('PINs do not match. Try again.'); pinMode='set'; pinSetFirst=''; }
  }
}
function pinError(msg){
  document.querySelectorAll('.pin-dot').forEach(d=>d.classList.add('error'));
  document.getElementById('pin-error').textContent=msg;
  setTimeout(()=>{ pinBuffer=''; updatePinDots(); document.getElementById('pin-error').textContent=''; },900);
}
function simpleHash(str){
  let h=0;
  for(let i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; }
  return h.toString(16);
}
function removePinLock(){ if(!confirm('Remove PIN lock?')) return; localStorage.removeItem('paisa_pin'); showToast('🔓','PIN removed.'); renderSettings(); }

/* ══════════════════════════════════════════
   PDF EXPORT
══════════════════════════════════════════ */
function exportPDF(){
  const {from,to}=getDashRange();
  const data=getDashData().sort((a,b)=>b.date.localeCompare(a.date));
  const total=data.reduce((s,e)=>s+e.amount,0);
  const days=Math.max(1,Math.round((new Date(to)-new Date(from))/86400000)+1);
  const avg=total/days;
  const todayData=expenses.filter(e=>e.date===today());
  const todayTotal=todayData.reduce((s,e)=>s+e.amount,0);
  const catTotals={}, payTotals={};
  data.forEach(e=>{ catTotals[e.category]=(catTotals[e.category]||0)+e.amount; payTotals[e.payment]=(payTotals[e.payment]||0)+e.amount; });
  const sortedCats=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]);
  const sortedPays=Object.entries(payTotals).sort((a,b)=>b[1]-a[1]);
  const byMonth={};
  data.forEach(e=>{ const k=e.date.slice(0,7); if(!byMonth[k]) byMonth[k]={total:0,count:0}; byMonth[k].total+=e.amount; byMonth[k].count++; });
  const sortedMonths=Object.entries(byMonth).sort((a,b)=>b[0].localeCompare(a[0]));
  const topCat=sortedCats[0];
  const d1=new Date(from+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
  const d2=new Date(to+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});
  const generatedAt=new Date().toLocaleString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const fmtR=v=>'₹'+Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
  const catRows=sortedCats.map(([n,v])=>`<tr style="border-bottom:1px solid #e8edf2"><td style="padding:10px 12px;font-size:12px">${getCatEmoji(n)} ${n}</td><td style="padding:10px 12px;font-size:12px;text-align:right;font-weight:600;color:#1a3c6e">${fmtR(v)}</td><td style="padding:10px 12px;font-size:12px;text-align:right;color:#64748b">${total>0?Math.round(v/total*100):0}%</td><td style="padding:10px 20px 10px 12px;width:180px"><div style="width:100%;background:#e8edf2;border-radius:3px;height:6px"><div style="width:${total>0?Math.round(v/total*100):0}%;background:#1a3c6e;height:6px;border-radius:3px"></div></div></td></tr>`).join('');
  const payRows=sortedPays.map(([n,v])=>`<tr style="border-bottom:1px solid #e8edf2"><td style="padding:9px 12px;font-size:12px">${n}</td><td style="padding:9px 12px;font-size:12px;text-align:right;font-weight:600;color:#1a3c6e">${fmtR(v)}</td><td style="padding:9px 12px;font-size:12px;text-align:right;color:#64748b">${total>0?Math.round(v/total*100):0}%</td></tr>`).join('');
  const monthRows=sortedMonths.map(([k,m])=>`<tr style="border-bottom:1px solid #e8edf2"><td style="padding:9px 12px;font-size:12px">${new Date(k+'-01').toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</td><td style="padding:9px 12px;font-size:12px;text-align:right;font-weight:600;color:#1a3c6e">${fmtR(m.total)}</td><td style="padding:9px 12px;font-size:12px;text-align:right;color:#64748b">${m.count} txns</td></tr>`).join('');
  const expRows=data.slice(0,100).map((e,i)=>`<tr style="background:${i%2===0?'#fff':'#f8fafc'}"><td style="padding:8px 12px;font-size:11px;color:#334155">${new Date(e.date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'})}</td><td style="padding:8px 12px;font-size:11px;color:#334155">${getCatEmoji(e.category)} ${e.category}</td><td style="padding:8px 12px;font-size:11px;color:#334155;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.notes||'—'}</td><td style="padding:8px 12px;font-size:11px;color:#334155">${e.payment}</td><td style="padding:8px 12px;font-size:11px;text-align:right;font-weight:600;color:#1a3c6e">${fmtR(e.amount)}</td></tr>`).join('');
  const dayLabel=dashFrom?`${d1} — ${d2}`:`Last ${days} Days`;
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Paisa Report</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#1e293b;font-size:13px;line-height:1.6}@page{margin:18mm 16mm;size:A4}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-break{page-break-inside:avoid}.page-break{page-break-before:always}}</style></head><body>
<div style="background:linear-gradient(135deg,#0f2444 0%,#1a3c6e 60%,#0d9e80 100%);padding:36px 40px 28px;color:#fff;position:relative;overflow:hidden">
  <div style="position:absolute;top:-30px;right:-30px;width:160px;height:160px;border-radius:50%;background:rgba(255,255,255,0.04)"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div><div style="font-size:32px;font-weight:800;letter-spacing:-1px;margin-bottom:2px">Paisa <span style="color:#00d4aa">₹</span></div><div style="font-size:13px;opacity:.7;letter-spacing:.5px;text-transform:uppercase">Personal Expense Report</div></div>
    <div style="text-align:right"><div style="font-size:18px;font-weight:700;color:#00d4aa">${dayLabel}</div><div style="font-size:11px;opacity:.7;margin-top:3px">${d1} — ${d2}</div></div>
  </div>
  <div style="margin-top:22px;padding-top:18px;border-top:1px solid rgba(255,255,255,.15);font-size:11px;opacity:.6">Generated on ${generatedAt} · Confidential</div>
</div>
<div style="padding:24px 40px 0">
  <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:14px">Executive Summary</div>
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px" class="no-break">
    <div style="background:#f0fdf9;border:1px solid #d1faf0;border-radius:10px;padding:16px;border-top:3px solid #00d4aa"><div style="font-size:10px;font-weight:600;text-transform:uppercase;color:#64748b;margin-bottom:6px">Today Spent</div><div style="font-size:18px;font-weight:800;color:#0d9e80">${fmtR(todayTotal)}</div><div style="font-size:10px;color:#94a3b8;margin-top:3px">${todayData.length} txn${todayData.length!==1?'s':''}</div></div>
    <div style="background:#f0f7ff;border:1px solid #c7deff;border-radius:10px;padding:16px;border-top:3px solid #1a3c6e"><div style="font-size:10px;font-weight:600;text-transform:uppercase;color:#64748b;margin-bottom:6px">Total Spent</div><div style="font-size:18px;font-weight:800;color:#1a3c6e">${fmtR(total)}</div><div style="font-size:10px;color:#94a3b8;margin-top:3px">${data.length} transactions</div></div>
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;border-top:3px solid #f59e0b"><div style="font-size:10px;font-weight:600;text-transform:uppercase;color:#64748b;margin-bottom:6px">Daily Average</div><div style="font-size:18px;font-weight:800;color:#b45309">${fmtR(avg)}</div><div style="font-size:10px;color:#94a3b8;margin-top:3px">over ${days} days</div></div>
    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:16px;border-top:3px solid #7c6af5"><div style="font-size:10px;font-weight:600;text-transform:uppercase;color:#64748b;margin-bottom:6px">Top Category</div><div style="font-size:14px;font-weight:800;color:#5b21b6">${topCat?getCatEmoji(topCat[0])+' '+topCat[0]:'—'}</div><div style="font-size:10px;color:#94a3b8;margin-top:3px">${topCat?fmtR(topCat[1]):''}</div></div>
    <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:16px;border-top:3px solid #f87171"><div style="font-size:10px;font-weight:600;text-transform:uppercase;color:#64748b;margin-bottom:6px">Categories</div><div style="font-size:18px;font-weight:800;color:#be123c">${sortedCats.length}</div><div style="font-size:10px;color:#94a3b8;margin-top:3px">${sortedPays.length} payment methods</div></div>
  </div>
</div>
<div style="padding:24px 40px 0" class="no-break">
  <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:14px">Category Breakdown</div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e8edf2;border-radius:10px;overflow:hidden"><thead><tr style="background:#1a3c6e;color:#fff"><th style="padding:10px 12px;font-size:11px;font-weight:600;text-align:left">Category</th><th style="padding:10px 12px;font-size:11px;font-weight:600;text-align:right">Amount</th><th style="padding:10px 12px;font-size:11px;font-weight:600;text-align:right">Share</th><th style="padding:10px 20px 10px 12px;font-size:11px;font-weight:600">Distribution</th></tr></thead><tbody>${catRows}</tbody><tfoot><tr style="background:#f0f7ff;border-top:2px solid #1a3c6e"><td style="padding:11px 12px;font-size:12px;font-weight:700">Total</td><td style="padding:11px 12px;font-size:12px;font-weight:700;text-align:right;color:#1a3c6e">${fmtR(total)}</td><td style="padding:11px 12px;font-size:12px;font-weight:700;text-align:right">100%</td><td></td></tr></tfoot></table>
</div>
<div style="padding:24px 40px 0;display:grid;grid-template-columns:1fr 1fr;gap:20px">
  <div class="no-break"><div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:14px">Payment Methods</div><table style="width:100%;border-collapse:collapse;border:1px solid #e8edf2;border-radius:8px;overflow:hidden"><thead><tr style="background:#1a3c6e;color:#fff"><th style="padding:9px 12px;font-size:11px;font-weight:600;text-align:left">Method</th><th style="padding:9px 12px;font-size:11px;font-weight:600;text-align:right">Amount</th><th style="padding:9px 12px;font-size:11px;font-weight:600;text-align:right">Share</th></tr></thead><tbody>${payRows}</tbody></table></div>
  <div class="no-break"><div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:14px">Monthly Summary</div><table style="width:100%;border-collapse:collapse;border:1px solid #e8edf2;border-radius:8px;overflow:hidden"><thead><tr style="background:#1a3c6e;color:#fff"><th style="padding:9px 12px;font-size:11px;font-weight:600;text-align:left">Month</th><th style="padding:9px 12px;font-size:11px;font-weight:600;text-align:right">Total</th><th style="padding:9px 12px;font-size:11px;font-weight:600;text-align:right">Count</th></tr></thead><tbody>${monthRows}</tbody></table></div>
</div>
<div style="padding:24px 40px 0" class="${data.length>20?'page-break':''}">
  <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;margin-bottom:14px">Transaction Details ${data.length>100?'(latest 100 of '+data.length+')':'('+data.length+' transactions)'}</div>
  <table style="width:100%;border-collapse:collapse;border:1px solid #e8edf2;overflow:hidden;border-radius:8px"><thead><tr style="background:#1a3c6e;color:#fff"><th style="padding:9px 12px;font-size:11px;text-align:left">Date</th><th style="padding:9px 12px;font-size:11px;text-align:left">Category</th><th style="padding:9px 12px;font-size:11px;text-align:left">Notes</th><th style="padding:9px 12px;font-size:11px;text-align:left">Payment</th><th style="padding:9px 12px;font-size:11px;text-align:right">Amount</th></tr></thead><tbody>${expRows}</tbody><tfoot><tr style="background:#f0f7ff;border-top:2px solid #1a3c6e"><td colspan="4" style="padding:10px 12px;font-size:12px;font-weight:700">Period Total</td><td style="padding:10px 12px;font-size:12px;font-weight:700;text-align:right;color:#1a3c6e">${fmtR(total)}</td></tr></tfoot></table>
</div>
<div style="padding:24px 40px 32px;margin-top:24px;border-top:1px solid #e8edf2;display:flex;justify-content:space-between;align-items:center"><div style="font-size:11px;color:#94a3b8">Paisa — Personal Expense Manager · ${dayLabel}</div><div style="font-size:11px;color:#94a3b8">All amounts in Indian Rupees (₹)</div></div>
<script>window.onload=()=>{ window.print(); }<\/script>
</body></html>`;
  const win=window.open('','_blank','width=900,height=700');
  if(!win){ showToast('⚠️','Allow popups to export PDF.'); return; }
  win.document.write(html); win.document.close();
  showToast('📄','PDF opened — use Print → Save as PDF.');
}

/* ══════════════════════════════════════════
   TOAST
══════════════════════════════════════════ */
function showToast(icon,msg){
  const c=document.getElementById('toast-container');
  const el=document.createElement('div'); el.className='toast';
  el.innerHTML=`<span class="toast-icon">${icon}</span><span class="toast-msg">${msg}</span><button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
  c.appendChild(el);
  setTimeout(()=>{ el.classList.add('removing'); setTimeout(()=>el.remove(),240); },3500);
}

/* ══════════════════════════════════════════
   KEYBOARD / RESIZE / INIT
══════════════════════════════════════════ */
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ closeExpenseModal(); closeImportModal(); closeDayModal(); closeCatModal(); }
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){ e.preventDefault(); openAddExpense(); }
});
window.addEventListener('resize',()=>{ if(currentPage==='dashboard') renderDashboard(); });

// Init
initTheme();
processRecurringExpenses();
renderDashboard();
updateLastBackup();
initPinLock();
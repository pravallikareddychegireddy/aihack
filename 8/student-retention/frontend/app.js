
const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : '/api';
let currentRole = 'admin';
let currentStudentId = null;
let allStudents = [];
let chartInstances = {};

// ── On page load: check if admin exists ───────────────────────────────────────
// ── CSV Upload ──────────────────────────────────────────────────────────────
function triggerCSVUpload() {
  const input = document.getElementById('csvUpload');
  if (!input.files.length) { alert('Please select a CSV file.'); return; }
  handleCSVUpload({ target: input });
}

function handleCSVUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  fetch(`${API}/admin/upload_csv`, {
    method: 'POST',
    body: formData
  })
    .then(r => r.json())
    .then(data => {
      if (data.status === 'success') {
        alert('CSV uploaded and students imported successfully!');
        loadStudents();
      } else {
        alert('Error: ' + data.message);
      }
    })
    .catch(() => alert('Upload failed. Please try again.'));
}
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch(`${API}/admin/exists`);
    const data = await res.json();
    if (!data.exists) {
      switchRole('admin');
      showAdminRegister();
    } else {
      document.getElementById('adminSetupLink').style.display = 'none';
    }
  } catch { /* server not reachable yet */ }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function switchRole(role) {
  currentRole = role;
  document.getElementById('roleAdminBtn').classList.toggle('active', role === 'admin');
  document.getElementById('roleStudentBtn').classList.toggle('active', role === 'student');
  const isAdmin = role === 'admin';
  document.getElementById('loginLabel').textContent = isAdmin ? 'Username' : 'Student Email';
  document.getElementById('loginUser').placeholder = isAdmin ? 'username' : 'email@university.edu';
  document.getElementById('loginHeading').textContent = isAdmin ? 'Admin Login' : 'Student Login';
  document.getElementById('loginSub').textContent = isAdmin
    ? 'Sign in to manage students and analytics'
    : 'Sign in to your academic portal';
  document.getElementById('loginHint').textContent = isAdmin
    ? 'Use the credentials you registered with'
    : 'Use your university email & password';
  document.getElementById('signupSwitch').style.display = isAdmin ? 'none' : 'block';
  // Show setup link only for admin tab (in case they need to register)
  fetch(`${API}/admin/exists`).then(r => r.json()).then(d => {
    document.getElementById('adminSetupLink').style.display = (isAdmin && !d.exists) ? 'block' : 'none';
  }).catch(() => {});
  showLogin();
}

function showSignup() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('adminRegisterView').style.display = 'none';
  document.getElementById('signupView').style.display = 'block';
}

function showLogin() {
  document.getElementById('signupView').style.display = 'none';
  document.getElementById('adminRegisterView').style.display = 'none';
  document.getElementById('loginView').style.display = 'block';
}

function showAdminRegister() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('signupView').style.display = 'none';
  document.getElementById('adminRegisterView').style.display = 'block';
}

async function doAdminRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('adminRegBtn');
  const err = document.getElementById('adminRegError');
  err.style.display = 'none';
  const pass = document.getElementById('adminRegPass').value;
  const confirm = document.getElementById('adminRegConfirm').value;
  if (pass !== confirm) { err.textContent = 'Passwords do not match.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    const res = await fetch(`${API}/admin/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('adminRegName').value.trim(),
        username: document.getElementById('adminRegUser').value.trim(),
        password: pass
      })
    });
    const data = await res.json();
    if (data.status === 'success') {
      showLogin();
      document.getElementById('loginHint').textContent = 'Admin account created! Sign in now.';
    } else { err.textContent = data.message; err.style.display = 'block'; }
  } catch { err.textContent = 'Cannot connect to server. Please try again.'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Create Admin Account'; }
}

function togglePass(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else { inp.type = 'password'; btn.textContent = '👁'; }
}

async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  err.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('loginUser').value.trim(),
        password: document.getElementById('loginPass').value.trim(),
        role: currentRole
      })
    });
    const data = await res.json();
    if (data.status === 'success') {
      document.getElementById('authPage').style.display = 'none';
      if (data.role === 'admin') {
        document.getElementById('adminApp').style.display = 'block';
        loadAnalytics(); loadStudents();
      } else {
        currentStudentId = data.id;
        document.getElementById('studentApp').style.display = 'block';
        document.getElementById('studentGreeting').textContent = '👋 ' + data.name;
        loadStudentData(data.id);
        // Show alert only for High Risk students
        if (data.warning) {
          showHighRiskAlert(data.warning, data.explanation || []);
        }
      }
    } else { err.textContent = data.message; err.style.display = 'block'; }
  } catch { err.textContent = 'Cannot connect to server. Make sure Flask is running on port 5000.'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Sign In'; }
}

async function doSignup(e) {
  e.preventDefault();
  const btn = document.getElementById('signupBtn');
  const err = document.getElementById('signupError');
  err.style.display = 'none';
  const pass = document.getElementById('signupPass').value;
  const confirm = document.getElementById('signupConfirm').value;
  if (pass !== confirm) { err.textContent = 'Passwords do not match.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const res = await fetch(`${API}/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('signupName').value.trim(),
        email: document.getElementById('signupEmail').value.trim(),
        password: pass
      })
    });
    const data = await res.json();
    if (data.status === 'success') {
      currentStudentId = data.id;
      document.getElementById('authPage').style.display = 'none';
      document.getElementById('studentApp').style.display = 'block';
      document.getElementById('studentGreeting').textContent = '👋 ' + data.name;
      loadStudentData(data.id);
    } else { err.textContent = data.message; err.style.display = 'block'; }
  } catch { err.textContent = 'Cannot connect to server.'; err.style.display = 'block'; }
  finally { btn.disabled = false; btn.textContent = 'Create Account'; }
}

// ── High Risk Alert (only shown to High Risk students) ───────────────────────
function showHighRiskAlert(warning, explanation) {
  // Remove any existing alert
  const existing = document.getElementById('highRiskAlert');
  if (existing) existing.remove();

  const factorsHtml = explanation.length
    ? `<div class="alert-factors">
        ${explanation.map(e => `<div class="alert-factor-item">
          <span class="alert-factor-name">${e.factor}</span>
          <span class="alert-factor-val">${e.value}</span>
          <span class="alert-factor-impact impact-${e.impact.toLowerCase().replace(' ','-')}">${e.impact}</span>
        </div>`).join('')}
      </div>` : '';

  const alert = document.createElement('div');
  alert.id = 'highRiskAlert';
  alert.className = 'high-risk-alert';
  alert.innerHTML = `
    <div class="alert-inner">
      <div class="alert-icon">🚨</div>
      <div class="alert-content">
        <div class="alert-title">High Dropout Risk Detected</div>
        <div class="alert-msg">Your academic profile indicates a high risk of dropout. Please review the factors below and visit the <strong>Advice</strong> tab for personalised guidance and learning resources.</div>
        ${factorsHtml}
        <div class="alert-actions">
          <button class="alert-btn-advice" onclick="document.querySelector('#studentApp .nav-btn:nth-child(3)').click()">📖 View Advice &amp; Resources</button>
          <button class="alert-dismiss" onclick="document.getElementById('highRiskAlert').remove()">Dismiss</button>
        </div>
      </div>
    </div>`;
  document.getElementById('studentApp').prepend(alert);
}

function logout() {
  currentStudentId = null; allStudents = [];
  Object.values(chartInstances).forEach(c => c && c.destroy());
  chartInstances = {};
  document.getElementById('authPage').style.display = 'flex';
  document.getElementById('adminApp').style.display = 'none';
  document.getElementById('studentApp').style.display = 'none';
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').style.display = 'none';
  showLogin();
}

// ── Tab navigation ────────────────────────────────────────────────────────────
function adminTab(name, btn) {
  document.querySelectorAll('#adminApp .tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#adminApp .nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('admin-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'students') loadStudents();
  if (name === 'dashboard') loadAnalytics();
}

function studentTab(name, btn) {
  document.querySelectorAll('#studentApp .tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#studentApp .nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('student-' + name).classList.add('active');
  btn.classList.add('active');
}

// ── Analytics Dashboard ───────────────────────────────────────────────────────
async function loadAnalytics() {
  const el = document.getElementById('analyticsContent');
  el.innerHTML = '<div class="loading-msg">⏳ Loading analytics…</div>';
  try {
    const res = await fetch(`${API}/admin/analytics`);
    const json = await res.json();
    if (json.status !== 'success' || !json.data || !json.data.total) {
      el.innerHTML = '<div class="loading-msg">⚠️ ' + (json.message || 'Train the model first to see analytics.') + '</div>';
      return;
    }
    renderAnalytics(json.data);
  } catch { el.innerHTML = '<div class="loading-msg">❌ Cannot connect to server.</div>'; }
}

function mkChart(id, config) {
  if (chartInstances[id]) { chartInstances[id].destroy(); }
  chartInstances[id] = new Chart(document.getElementById(id), config);
}

function renderAnalytics(d) {
  const el = document.getElementById('analyticsContent');
  el.innerHTML = `
    <div class="cards-grid">
      <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-value">${d.total}</div><div class="stat-label">Total Students</div></div>
      <div class="stat-card danger"><div class="stat-icon">🔴</div><div class="stat-value">${d.high_risk}</div><div class="stat-label">High Risk</div></div>
      <div class="stat-card warning"><div class="stat-icon">🟡</div><div class="stat-value">${d.medium_risk}</div><div class="stat-label">Medium Risk</div></div>
      <div class="stat-card success"><div class="stat-icon">🟢</div><div class="stat-value">${d.low_risk}</div><div class="stat-label">Low Risk</div></div>
      <div class="stat-card"><div class="stat-icon">📚</div><div class="stat-value">${d.avg_gpa}</div><div class="stat-label">Avg GPA</div></div>
      <div class="stat-card"><div class="stat-icon">📅</div><div class="stat-value">${d.avg_attendance}%</div><div class="stat-label">Avg Attendance</div></div>
      <div class="stat-card"><div class="stat-icon">💻</div><div class="stat-value">${d.avg_lms}</div><div class="stat-label">Avg LMS Logins</div></div>
      <div class="stat-card warning"><div class="stat-icon">💰</div><div class="stat-value">${d.financial_risk_count}</div><div class="stat-label">Financial Risk</div></div>
    </div>
    <div class="charts-row">
      <div class="card chart-card"><h3>📊 Risk Distribution</h3><canvas id="riskDistChart"></canvas></div>
      <div class="card chart-card"><h3>📚 Avg GPA by Major</h3><canvas id="gpaByMajorChart"></canvas></div>
      <div class="card chart-card"><h3>📅 Attendance Distribution</h3><canvas id="attDistChart"></canvas></div>
      <div class="card chart-card"><h3>💻 LMS Activity</h3><canvas id="lmsDistChart"></canvas></div>
    </div>
    <div class="charts-row">
      <div class="card chart-card"><h3>🎓 Students by Year</h3><canvas id="yearDistChart"></canvas></div>
      <div class="card" style="grid-column:span 2">
        <p class="section-title">⚠️ At-Risk Students (${d.at_risk_student_list.length})</p>
        <div class="risk-table-wrap">
          <table class="data-table">
            <thead><tr><th>#</th><th>Name</th><th>Risk</th><th>Dropout %</th><th>GPA</th><th>Attendance</th></tr></thead>
            <tbody>${d.at_risk_student_list.map((s, i) =>
              '<tr><td>' + (i+1) + '</td><td>' + s.name + '</td>' +
              '<td><span class="badge badge-' + s.risk_level.toLowerCase() + '">' + s.risk_level + '</span></td>' +
              '<td>' + Math.round(s.dropout_probability * 100) + '%</td>' +
              '<td>' + s.gpa + '</td><td>' + s.attendance + '%</td></tr>'
            ).join('') || '<tr><td colspan="6" style="text-align:center;color:#64748b">No at-risk students</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  const scaleOpts = (yMin, yMax) => ({
    y: { min: yMin, max: yMax, ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
    x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
  });

  mkChart('riskDistChart', {
    type: 'doughnut',
    data: { labels: ['Low Risk','Medium Risk','High Risk'],
      datasets: [{ data: [d.low_risk, d.medium_risk, d.high_risk],
        backgroundColor: ['#22c55e','#f59e0b','#ef4444'], borderWidth: 0 }] },
    options: { plugins: { legend: { labels: { color: '#94a3b8' } } }, cutout: '60%' }
  });

  const majors = Object.keys(d.gpa_by_major);
  mkChart('gpaByMajorChart', {
    type: 'bar',
    data: { labels: majors, datasets: [{ label: 'Avg GPA', data: majors.map(m => d.gpa_by_major[m]), backgroundColor: '#38bdf8', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: scaleOpts(0, 10) }
  });

  const attL = Object.keys(d.attendance_distribution);
  mkChart('attDistChart', {
    type: 'bar',
    data: { labels: attL, datasets: [{ data: attL.map(k => d.attendance_distribution[k]),
      backgroundColor: ['#ef4444','#f59e0b','#38bdf8','#22c55e'], borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: scaleOpts(undefined, undefined) }
  });

  const lmsL = Object.keys(d.lms_distribution);
  mkChart('lmsDistChart', {
    type: 'bar',
    data: { labels: lmsL, datasets: [{ data: lmsL.map(k => d.lms_distribution[k]), backgroundColor: '#a78bfa', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: scaleOpts(undefined, undefined) }
  });

  const yrL = Object.keys(d.year_distribution).sort();
  mkChart('yearDistChart', {
    type: 'bar',
    data: { labels: yrL, datasets: [{ data: yrL.map(k => d.year_distribution[k]), backgroundColor: '#34d399', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: scaleOpts(undefined, undefined) }
  });
}

// ── Students Table ────────────────────────────────────────────────────────────
async function loadStudents() {
  const el = document.getElementById('studentsTable');
  el.innerHTML = '<div class="loading-msg">⏳ Loading students…</div>';
  try {
    const res = await fetch(`${API}/admin/students`);
    const json = await res.json();
    allStudents = json.students || [];
    renderStudentsTable(allStudents);
  } catch { el.innerHTML = '<div class="loading-msg">❌ Cannot connect to server.</div>'; }
}

function renderStudentsTable(students) {
  const el = document.getElementById('studentsTable');
  if (!students.length) { el.innerHTML = '<div class="loading-msg">No students found.</div>'; return; }
  el.innerHTML = `
    <div class="risk-table-wrap">
      <table class="data-table">
        <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Major</th><th>Year</th><th>GPA</th><th>Attendance</th><th>Risk</th><th>Dropout %</th><th>Actions</th></tr></thead>
        <tbody>${students.map(s => `
          <tr${s.risk_level === 'High' ? ' style="background:#fee2e2"' : ''}>
            <td>${s.id}</td><td>${s.name}</td>
            <td style="color:#64748b;font-size:0.8rem">${s.email}</td>
            <td>${s.major}</td><td>Year ${s.year}</td>
            <td>${s.gpa}</td><td>${s.attendance}%</td>
            <td><span class="badge badge-${(s.risk_level||'unknown').toLowerCase()}">${s.risk_level||'N/A'}</span></td>
            <td>${s.dropout_probability != null ? Math.round(s.dropout_probability*100)+'%' : 'N/A'}</td>
            <td><div class="actions">
              <button class="btn-sm btn-view" onclick="viewStudent(${s.id})">👁 View</button>
              <button class="btn-sm btn-edit" onclick="openEditModal(${s.id})">✏️ Edit</button>
              <button class="btn-sm btn-delete" onclick="deleteStudent(${s.id})">🗑</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function filterStudents() {
  const q = document.getElementById('studentSearch').value.toLowerCase();
  const risk = document.getElementById('riskFilter').value;
  renderStudentsTable(allStudents.filter(s =>
    (!q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q)) &&
    (!risk || s.risk_level === risk)
  ));
}

async function deleteStudent(id) {
  if (!confirm('Delete this student?')) return;
  await fetch(`${API}/admin/students/${id}`, { method: 'DELETE' });
  loadStudents();
}

// ── View Student Modal ────────────────────────────────────────────────────────
function viewStudent(id) {
  const s = allStudents.find(x => x.id === id);
  if (!s) return;
  const riskColor = { High: '#ef4444', Medium: '#f59e0b', Low: '#22c55e' }[s.risk_level] || '#64748b';
  const pct = s.dropout_probability != null ? Math.round(s.dropout_probability * 100) : null;

  const warningsHtml = (s.warnings || []).map(w =>
    `<div class="warning-item ${w.type}">⚠️ ${w.msg}</div>`).join('');

  const explanationHtml = (s.explanation || []).map(e =>
    `<div class="explanation-item">
      <span class="exp-factor">${e.factor}</span>
      <span class="exp-value">${e.value}</span>
      <span class="exp-impact impact-${e.impact.toLowerCase().replace(' ','-')}">${e.impact}</span>
    </div>`).join('');

  const careerHtml = s.career ? `
    <div class="detail-section"><h4>💼 Career Recommendations</h4>
      <div>${s.career.recommended_paths.map(p => `<span class="pathway-tag">${p}</span>`).join('')}</div>
      <div style="font-size:0.8rem;color:#64748b;margin-top:0.4rem">Skills: ${s.career.suggested_skills.join(', ')}</div>
    </div>` : '';

  const learningHtml = (s.learning_path||[]).length ? `
    <div class="detail-section"><h4>🛤️ Adaptive Learning Path</h4>
      <ol style="padding-left:1.2rem">${s.learning_path.map(step =>
        `<li style="font-size:0.82rem;color:#cbd5e1;margin-bottom:0.3rem">${step}</li>`).join('')}</ol>
    </div>` : '';

  const financialHtml = (s.financial_support||[]).length ? `
    <div class="detail-section"><h4>💰 Financial Support</h4>
      <ul style="padding-left:1.2rem">${s.financial_support.map(f =>
        `<li style="font-size:0.82rem;color:#cbd5e1;margin-bottom:0.3rem">${f}</li>`).join('')}</ul>
    </div>` : '';

  openModal('Student Profile', `<div class="modal-body">
    <div style="text-align:center;margin-bottom:1.25rem">
      <div class="profile-avatar" style="margin:0 auto 0.75rem">${s.name.charAt(0)}</div>
      <div class="profile-name">${s.name}</div>
      <div class="profile-email">${s.email}</div>
      ${pct != null ? `<div class="risk-gauge" style="border-color:${riskColor};color:${riskColor};width:80px;height:80px;font-size:1.2rem;margin:0.75rem auto 0.4rem">${pct}%</div>
      <span class="badge badge-${(s.risk_level||'unknown').toLowerCase()}">${s.risk_level||'N/A'} Risk</span>` : ''}
    </div>
    ${warningsHtml ? `<div class="detail-section"><h4>🚨 Active Warnings</h4>${warningsHtml}</div>` : ''}
    <div class="detail-section"><h4>📋 Academic Info</h4>
      <div class="detail-grid">
        <div class="detail-item"><span>GPA: </span><span>${s.gpa}</span></div>
        <div class="detail-item"><span>Attendance: </span><span>${s.attendance}%</span></div>
        <div class="detail-item"><span>LMS Logins: </span><span>${s.lms_logins}</span></div>
        <div class="detail-item"><span>Assignments: </span><span>${s.assignments_submitted}/20</span></div>
        <div class="detail-item"><span>Major: </span><span>${s.major}</span></div>
        <div class="detail-item"><span>Year: </span><span>Year ${s.year}</span></div>
        <div class="detail-item"><span>Prev Failures: </span><span>${s.prev_failures}</span></div>
        <div class="detail-item"><span>Extracurricular: </span><span>${s.extracurricular ? 'Yes' : 'No'}</span></div>
      </div>
    </div>
    <div class="detail-section"><h4>👤 Personal Info</h4>
      <div class="detail-grid">
        <div class="detail-item"><span>Age: </span><span>${s.age}</span></div>
        <div class="detail-item"><span>Gender: </span><span>${s.gender}</span></div>
        <div class="detail-item"><span>Part-time Job: </span><span>${s.part_time_job ? 'Yes' : 'No'}</span></div>
        <div class="detail-item"><span>Financial Aid: </span><span>${s.financial_aid ? 'Yes' : 'No'}</span></div>
        <div class="detail-item"><span>Tuition Balance: </span><span>$${Number(s.tuition_balance).toLocaleString()}</span></div>
        <div class="detail-item"><span>Mental Health Visits: </span><span>${s.mental_health_visits}</span></div>
        <div class="detail-item"><span>Distance: </span><span>${s.distance_from_campus} km</span></div>
      </div>
    </div>
    ${explanationHtml ? `<div class="detail-section"><h4>🧠 AI Risk Explanation</h4>${explanationHtml}</div>` : ''}
    ${(s.recommendations||[]).length ? `<div class="detail-section"><h4>📋 Recommendations</h4>
      <ul style="padding-left:1.2rem">${s.recommendations.map(r =>
        `<li style="font-size:0.82rem;color:#cbd5e1;margin-bottom:0.3rem">${r}</li>`).join('')}</ul>
    </div>` : ''}
    ${careerHtml}${learningHtml}${financialHtml}
  </div>`);
}

// ── Add / Edit Student Modal ──────────────────────────────────────────────────
function studentFormFields(s) {
  s = s || {};
  const sel = (id, label, options) => `<div class="form-group"><label>${label}</label>
    <select id="mf_${id}">${options.map(o =>
      `<option value="${o.v}" ${String(s[id]) === String(o.v) ? 'selected' : ''}>${o.l}</option>`
    ).join('')}</select></div>`;
  const num = (id, label, min, max, def, step) => `<div class="form-group"><label>${label}</label>
    <input type="number" id="mf_${id}" value="${s[id] != null ? s[id] : def}"
      min="${min}" ${max != null ? 'max="'+max+'"' : ''} ${step ? 'step="'+step+'"' : ''} required/></div>`;
  const txt = (id, label, type, ph) => `<div class="form-group"><label>${label}</label>
    <input type="${type}" id="mf_${id}" value="${s[id] || ''}" placeholder="${ph}" required/></div>`;

  return `<div class="modal-body"><div class="modal-form-grid">
    ${txt('name','Full Name','text','Student name')}
    ${txt('email','Email','email','email@university.edu')}
    ${num('gpa','GPA (0-4.0)',0,4,2.5,0.01)}
    ${num('attendance','Attendance (%)',0,100,75,0.1)}
    ${num('lms_logins','LMS Logins',0,null,20,null)}
    ${num('assignments_submitted','Assignments Submitted',0,20,14,null)}
    ${sel('financial_aid','Financial Aid',[{v:1,l:'Yes'},{v:0,l:'No'}])}
    ${num('tuition_balance','Tuition Balance ($)',0,null,3000,null)}
    ${sel('part_time_job','Part-time Job',[{v:0,l:'No'},{v:1,l:'Yes'}])}
    ${num('age','Age',17,60,20,null)}
    ${sel('gender','Gender',[{v:'M',l:'Male'},{v:'F',l:'Female'},{v:'Other',l:'Other'}])}
    ${sel('major','Major',['Engineering','Business','Arts','Science','Education'].map(m=>({v:m,l:m})))}
    ${sel('year','Year',[{v:1,l:'1st Year'},{v:2,l:'2nd Year'},{v:3,l:'3rd Year'},{v:4,l:'4th Year'}])}
    ${num('prev_failures','Previous Failures',0,5,0,null)}
    ${sel('extracurricular','Extracurricular',[{v:0,l:'No'},{v:1,l:'Yes'}])}
    ${num('mental_health_visits','Mental Health Visits',0,10,0,null)}
    ${num('distance_from_campus','Distance (km)',0,null,10,0.1)}
  </div>
  <div class="modal-actions">
    <button class="btn-secondary" onclick="closeModal()">Cancel</button>
    <button class="btn-primary" id="modalSaveBtn" style="width:auto" onclick="saveStudent(${s.id || 'null'})">Save Student</button>
  </div></div>`;
}

function openAddModal() { openModal('Add Student', studentFormFields()); }

function openEditModal(id) {
  const s = allStudents.find(x => x.id === id);
  if (s) openModal('Edit Student', studentFormFields(s));
}

function getFormData() {
  const g = id => document.getElementById('mf_' + id);
  return {
    name: g('name').value.trim(), email: g('email').value.trim(),
    gpa: parseFloat(g('gpa').value), attendance: parseFloat(g('attendance').value),
    lms_logins: parseInt(g('lms_logins').value),
    assignments_submitted: parseInt(g('assignments_submitted').value),
    financial_aid: parseInt(g('financial_aid').value),
    tuition_balance: parseFloat(g('tuition_balance').value),
    part_time_job: parseInt(g('part_time_job').value),
    age: parseInt(g('age').value), gender: g('gender').value,
    major: g('major').value, year: parseInt(g('year').value),
    prev_failures: parseInt(g('prev_failures').value),
    extracurricular: parseInt(g('extracurricular').value),
    mental_health_visits: parseInt(g('mental_health_visits').value),
    distance_from_campus: parseFloat(g('distance_from_campus').value)
  };
}

async function saveStudent(id) {
  const btn = document.getElementById('modalSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const url = id ? `${API}/admin/students/${id}` : `${API}/admin/students`;
    const res = await fetch(url, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getFormData())
    });
    const json = await res.json();
    if (json.status === 'success') { closeModal(); loadStudents(); }
    else alert('Error: ' + json.message);
  } catch { alert('Cannot connect to server.'); }
  finally { btn.disabled = false; btn.textContent = 'Save Student'; }
}

// ── Risk Predictor ────────────────────────────────────────────────────────────
function doPrediction(e) {
  e.preventDefault();
  const btn = document.getElementById('predictBtn');
  btn.disabled = true; btn.textContent = 'Analyzing…';
  const payload = {
    gpa: parseFloat(document.getElementById('p_gpa').value),
    attendance: parseFloat(document.getElementById('p_attendance').value),
    lms_logins: parseInt(document.getElementById('p_lms_logins').value),
    assignments_submitted: parseInt(document.getElementById('p_assignments_submitted').value),
    financial_aid: parseInt(document.getElementById('p_financial_aid').value),
    tuition_balance: parseFloat(document.getElementById('p_tuition_balance').value),
    part_time_job: parseInt(document.getElementById('p_part_time_job').value),
    age: parseInt(document.getElementById('p_age').value),
    gender: document.getElementById('p_gender').value,
    major: document.getElementById('p_major').value,
    year: parseInt(document.getElementById('p_year').value),
    prev_failures: parseInt(document.getElementById('p_prev_failures').value),
    extracurricular: parseInt(document.getElementById('p_extracurricular').value),
    mental_health_visits: parseInt(document.getElementById('p_mental_health_visits').value),
    distance_from_campus: parseFloat(document.getElementById('p_distance_from_campus').value)
  };
  fetch(`${API}/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(r => r.json())
    .then(data => { if (data.status === 'success') renderPredictResult(data); else alert('Error: ' + data.message); })
    .catch(() => alert('Cannot connect to backend. Make sure Flask is running on port 5000.'))
    .finally(() => { btn.disabled = false; btn.textContent = 'Analyze Risk'; });
}

function renderPredictResult(data) {
  const card = document.getElementById('resultCard');
  card.style.display = 'block';
  const pct = Math.round(data.dropout_probability * 100);
  const color = { High: '#ef4444', Medium: '#f59e0b', Low: '#22c55e' }[data.risk_level] || '#64748b';

  const warningsHtml = (data.warnings||[]).map(w =>
    `<div class="warning-item ${w.type}">⚠️ ${w.msg}</div>`).join('');
  const explanationHtml = (data.explanation||[]).map(e =>
    `<div class="explanation-item">
      <span class="exp-factor">${e.factor}</span>
      <span class="exp-value">${e.value}</span>
      <span class="exp-impact impact-${e.impact.toLowerCase().replace(' ','-')}">${e.impact}</span>
    </div>`).join('');
  const careerHtml = data.career ? `<div class="section-block"><h4>💼 Career Paths</h4>
    <div>${data.career.recommended_paths.map(p => `<span class="pathway-tag">${p}</span>`).join('')}</div>
    <div style="font-size:0.8rem;color:#64748b;margin-top:0.4rem">Skills: ${data.career.suggested_skills.join(', ')}</div>
  </div>` : '';
  const learningHtml = (data.learning_path||[]).length ? `<div class="section-block"><h4>🛤️ Learning Path</h4>
    <ol style="padding-left:1.2rem">${data.learning_path.map(s =>
      `<li style="font-size:0.82rem;color:#cbd5e1;margin-bottom:0.25rem">${s}</li>`).join('')}</ol>
  </div>` : '';
  const financialHtml = (data.financial_support||[]).length ? `<div class="section-block"><h4>💰 Financial Support</h4>
    <ul style="padding-left:1.2rem">${data.financial_support.map(f =>
      `<li style="font-size:0.82rem;color:#cbd5e1;margin-bottom:0.25rem">${f}</li>`).join('')}</ul>
  </div>` : '';

  card.innerHTML = `
    <div class="risk-gauge" style="border-color:${color};color:${color}">${pct}%</div>
    <div class="risk-prob">Dropout Probability: ${pct}%</div>
    <span class="risk-badge badge-${data.risk_level.toLowerCase()}">${data.risk_level} Risk</span>
    ${warningsHtml ? `<div class="section-block"><h4>🚨 Warnings</h4>${warningsHtml}</div>` : ''}
    ${explanationHtml ? `<div class="section-block"><h4>🧠 AI Explanation</h4>${explanationHtml}</div>` : ''}
    <div class="section-block"><h4>📋 Recommendations</h4>
      <ul>${(data.recommendations||[]).map(r => `<li>${r}</li>`).join('')}</ul>
    </div>
    ${careerHtml}${learningHtml}${financialHtml}`;
  card.scrollIntoView({ behavior: 'smooth' });
}

// ── Train Models ──────────────────────────────────────────────────────────────
async function trainModels() {
  const btn = document.getElementById('trainBtn');
  const status = document.getElementById('trainStatus');
  btn.disabled = true; btn.textContent = '⏳ Training…';
  status.innerHTML = '<div class="loading-msg">Training models on 10,000 records… this may take 30–60 seconds.</div>';
  document.getElementById('trainResults').style.display = 'none';
  try {
    const res = await fetch(`${API}/train`, { method: 'POST' });
    const data = await res.json();
    if (data.status === 'success') {
      status.innerHTML = '<div class="loading-msg" style="color:#22c55e">✅ Training complete! Best model: ' + data.best_model + '</div>';
      renderTrainResults(data);
    } else {
      status.innerHTML = '<div class="loading-msg" style="color:#ef4444">❌ ' + data.message + '</div>';
    }
  } catch {
    status.innerHTML = '<div class="loading-msg" style="color:#ef4444">❌ Cannot connect to server.</div>';
  } finally {
    btn.disabled = false; btn.textContent = 'Start Training';
  }
}

function renderTrainResults(data) {
  const wrap = document.getElementById('trainResults');
  wrap.style.display = 'flex';
  const models = Object.entries(data.results);
  const table = document.getElementById('resultsTable');
  const best = data.best_model;
  table.innerHTML = `
    <thead><tr><th>Model</th><th>AUC</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead>
    <tbody>${models.map(([name, r]) =>
      `<tr style="${name === best ? 'background:#0f2a1a;font-weight:600;color:#22c55e' : name === 'ensemble' ? 'background:#0f1f2e' : ''}">
        <td>${name === 'ensemble' ? '🔗 ensemble' : name}${name === best ? ' ⭐' : ''}</td>
        <td>${r.auc}</td><td>${r.accuracy}</td><td>${r.precision}</td><td>${r.recall}</td><td>${r.f1}</td>
      </tr>`
    ).join('')}</tbody>`;

  const labels = data.feature_importance.map(f => f[0]);
  const values = data.feature_importance.map(f => f[1]);
  mkChart('trainFeatureChart', {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Importance', data: values, backgroundColor: '#38bdf8', borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
        y: { ticks: { color: '#94a3b8' }, grid: { display: false } }
      }
    }
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(title, bodyHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHtml;
  document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

// ── Student Portal ────────────────────────────────────────────────────────────
async function loadStudentData(id) {
  try {
    const res = await fetch(`${API}/student/${id}`);
    const json = await res.json();
    if (json.status === 'success') {
      const s = json.student;
      // New student with no data yet — show onboarding form
      if (s.gpa === 0 && s.attendance === 0 && s.lms_logins === 0) {
        renderOnboarding(s);
      } else {
        renderStudentOverview(s);
        renderStudentPerformance(s);
        renderStudentAdvice(s);
      }
    }
  } catch {
    document.getElementById('studentOverviewContent').innerHTML =
      '<div class="loading-msg">❌ Cannot connect to server.</div>';
  }
}

function renderOnboarding(s) {
  document.getElementById('studentOverviewContent').innerHTML = `
    <div class="card" style="max-width:700px;margin:2rem auto;padding:2rem">
      <div style="text-align:center;margin-bottom:1.5rem">
        <div class="profile-avatar" style="margin:0 auto 0.75rem">${s.name.charAt(0)}</div>
        <div class="profile-name">Welcome, ${s.name}!</div>
        <p style="color:#64748b;margin-top:0.4rem;font-size:0.9rem">Please fill in your academic details so we can assess your profile.</p>
      </div>
      <div class="modal-form-grid">
        <div class="form-group"><label>GPA (0–4.0)</label><input type="number" id="ob_gpa" step="0.01" min="0" max="4" placeholder="e.g. 3.2" required/></div>
        <div class="form-group"><label>Attendance (%)</label><input type="number" id="ob_attendance" step="0.1" min="0" max="100" placeholder="e.g. 85"/></div>
        <div class="form-group"><label>LMS Logins (this month)</label><input type="number" id="ob_lms_logins" min="0" placeholder="e.g. 20"/></div>
        <div class="form-group"><label>Assignments Submitted</label><input type="number" id="ob_assignments_submitted" min="0" max="20" placeholder="e.g. 14"/></div>
        <div class="form-group"><label>Age</label><input type="number" id="ob_age" min="17" max="60" placeholder="e.g. 20"/></div>
        <div class="form-group"><label>Gender</label>
          <select id="ob_gender"><option value="M">Male</option><option value="F">Female</option><option value="Other">Other</option></select>
        </div>
        <div class="form-group"><label>Major</label>
          <select id="ob_major"><option>Engineering</option><option>Business</option><option>Arts</option><option>Science</option><option>Education</option></select>
        </div>
        <div class="form-group"><label>Year</label>
          <select id="ob_year"><option value="1">1st Year</option><option value="2">2nd Year</option><option value="3">3rd Year</option><option value="4">4th Year</option></select>
        </div>
        <div class="form-group"><label>Previous Failures</label><input type="number" id="ob_prev_failures" min="0" max="5" value="0"/></div>
        <div class="form-group"><label>Mental Health Visits</label><input type="number" id="ob_mental_health_visits" min="0" max="10" value="0"/></div>
        <div class="form-group"><label>Financial Aid</label>
          <select id="ob_financial_aid"><option value="1">Yes</option><option value="0">No</option></select>
        </div>
        <div class="form-group"><label>Tuition Balance ($)</label><input type="number" id="ob_tuition_balance" min="0" value="0"/></div>
        <div class="form-group"><label>Part-time Job</label>
          <select id="ob_part_time_job"><option value="0">No</option><option value="1">Yes</option></select>
        </div>
        <div class="form-group"><label>Extracurricular</label>
          <select id="ob_extracurricular"><option value="0">No</option><option value="1">Yes</option></select>
        </div>
        <div class="form-group"><label>Distance from Campus (km)</label><input type="number" id="ob_distance_from_campus" step="0.1" min="0" value="0"/></div>
      </div>
      <div id="obError" class="auth-error" style="display:none;margin-top:0.5rem"></div>
      <button class="btn-primary" style="margin-top:1.25rem" onclick="saveStudentProfile(${s.student_id || s.id})">Save & View My Dashboard</button>
    </div>`;
  // hide other tabs until profile is filled
  document.getElementById('student-performance').innerHTML = '<div class="loading-msg">Complete your profile first.</div>';
  document.getElementById('student-advice').innerHTML = '<div class="loading-msg">Complete your profile first.</div>';
}

async function saveStudentProfile(id) {
  const g = field => document.getElementById('ob_' + field);
  const gpa = parseFloat(g('gpa').value);
  if (!gpa || gpa < 0 || gpa > 4) {
    const err = document.getElementById('obError');
    err.textContent = 'Please enter a valid GPA between 0 and 4.'; err.style.display = 'block'; return;
  }
  const payload = {
    gpa,
    attendance: parseFloat(g('attendance').value) || 0,
    lms_logins: parseInt(g('lms_logins').value) || 0,
    assignments_submitted: parseInt(g('assignments_submitted').value) || 0,
    age: parseInt(g('age').value) || 18,
    gender: g('gender').value,
    major: g('major').value,
    year: parseInt(g('year').value),
    prev_failures: parseInt(g('prev_failures').value) || 0,
    mental_health_visits: parseInt(g('mental_health_visits').value) || 0,
    financial_aid: parseInt(g('financial_aid').value),
    tuition_balance: parseFloat(g('tuition_balance').value) || 0,
    part_time_job: parseInt(g('part_time_job').value),
    extracurricular: parseInt(g('extracurricular').value),
    distance_from_campus: parseFloat(g('distance_from_campus').value) || 0
  };
  try {
    const res = await fetch(`${API}/student/${id}/update`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.status === 'success') {
      loadStudentData(id);
    } else {
      const err = document.getElementById('obError');
      err.textContent = json.message; err.style.display = 'block';
    }
  } catch {
    const err = document.getElementById('obError');
    err.textContent = 'Cannot connect to server.'; err.style.display = 'block';
  }
}

function renderStudentOverview(s) {
  const pct = s.dropout_probability != null ? Math.round(s.dropout_probability * 100) : null;
  const color = { High: '#ef4444', Medium: '#f59e0b', Low: '#22c55e' }[s.risk_level] || '#64748b';
  // Only show warnings if student has real data
  const hasData = s.gpa > 0 || s.attendance > 0;
  const warningsHtml = hasData ? (s.warnings || []).map(w =>
    `<div class="warning-item ${w.type}">⚠️ ${w.msg}</div>`).join('') : '';

  document.getElementById('studentOverviewContent').innerHTML = `
    <div class="cards-grid">
      <div class="stat-card"><div class="stat-icon">📚</div><div class="stat-value">${s.gpa || '—'}</div><div class="stat-label">GPA</div></div>
      <div class="stat-card"><div class="stat-icon">📅</div><div class="stat-value">${s.attendance ? s.attendance + '%' : '—'}</div><div class="stat-label">Attendance</div></div>
      <div class="stat-card"><div class="stat-icon">💻</div><div class="stat-value">${s.lms_logins || '—'}</div><div class="stat-label">LMS Logins</div></div>
      <div class="stat-card"><div class="stat-icon">📝</div><div class="stat-value">${s.assignments_submitted}/20</div><div class="stat-label">Assignments</div></div>
    </div>
    <div class="card" style="margin:1rem 1.5rem;padding:1.5rem">
      <div style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap">
        <div class="profile-avatar">${s.name.charAt(0)}</div>
        <div>
          <div class="profile-name">${s.name}</div>
          <div class="profile-email">${s.email}</div>
          <div style="margin-top:0.4rem">${s.major} · Year ${s.year}</div>
        </div>
        ${hasData && pct != null ? `<div style="margin-left:auto;text-align:center">
          <div class="risk-gauge" style="border-color:${color};color:${color};width:80px;height:80px;font-size:1.2rem">${pct}%</div>
          <span class="badge badge-${(s.risk_level||'unknown').toLowerCase()}" style="margin-top:0.4rem">${s.risk_level} Risk</span>
        </div>` : ''}
      </div>
      ${warningsHtml ? `<div style="margin-top:1rem">${warningsHtml}</div>` : ''}
    </div>`;
}

function renderStudentPerformance(s) {
  document.getElementById('studentPerfContent').innerHTML = `
    <div class="perf-card" style="margin:1rem 1.5rem;padding:1.5rem">
      <h3 style="color:#A78BFA;margin-bottom:1rem">📈 Academic Performance Board</h3>
      <div class="perf-metrics-grid">
        <div class="perf-metric">
          <span class="perf-label">GPA</span>
          <span class="perf-value">${s.gpa}</span>
          <div class="perf-bar"><div class="perf-bar-fill" style="width:${(s.gpa/4)*100}%;background:#7C5CFF"></div></div>
        </div>
        <div class="perf-metric">
          <span class="perf-label">Attendance</span>
          <span class="perf-value">${s.attendance}%</span>
          <div class="perf-bar"><div class="perf-bar-fill" style="width:${s.attendance}%;background:#22c55e"></div></div>
        </div>
        <div class="perf-metric">
          <span class="perf-label">LMS Logins</span>
          <span class="perf-value">${s.lms_logins}</span>
          <div class="perf-bar"><div class="perf-bar-fill" style="width:${Math.min(s.lms_logins,30)/30*100}%;background:#38bdf8"></div></div>
        </div>
        <div class="perf-metric">
          <span class="perf-label">Assignments</span>
          <span class="perf-value">${s.assignments_submitted}/20</span>
          <div class="perf-bar"><div class="perf-bar-fill" style="width:${(s.assignments_submitted/20)*100}%;background:#f59e0b"></div></div>
        </div>
      </div>
      <div class="perf-details-grid">
        <div class="perf-detail"><span>Previous Failures:</span> <span>${s.prev_failures}</span></div>
        <div class="perf-detail"><span>Mental Health Visits:</span> <span>${s.mental_health_visits}</span></div>
        <div class="perf-detail"><span>Financial Aid:</span> <span>${s.financial_aid ? 'Yes' : 'No'}</span></div>
        <div class="perf-detail"><span>Tuition Balance:</span> <span>$${Number(s.tuition_balance).toLocaleString()}</span></div>
      </div>
      ${(s.explanation||[]).length ? `<h4 style="margin-top:1.25rem;color:#94a3b8">🧠 AI Risk Factors</h4>
        <div class="perf-explanation-list">${s.explanation.map(e => `<div class="explanation-item">
          <span class="exp-factor">${e.factor}</span>
          <span class="exp-value">${e.value}</span>
          <span class="exp-impact impact-${e.impact.toLowerCase().replace(' ','-')}">${e.impact}</span>
        </div>`).join('')}</div>` : ''}
    </div>`;
}

function renderStudentAdvice(s) {
  const isHighRisk = s.risk_level === 'High';

  const adviceIntro = `<div class="card advice-card" style="padding:1.5rem">
    <h3 style="color:#A78BFA;margin-bottom:0.75rem">🌟 Advice from HOD</h3>
    <p style="color:#A8A3B8;font-size:1rem;margin-bottom:0.7rem">As your Head of Department, my goal is to help you succeed academically and personally. Here are tailored suggestions and encouragement for your journey:</p>
    ${isHighRisk ? '<div class="advice-risk-notice">⚠️ You are currently at <strong>High Risk</strong> of dropout. Please take the recommendations below seriously and use the learning resources provided.</div>' : ''}
  </div>`;

  const recsHtml = (s.recommendations||[]).length ? `<div class="card advice-card" style="padding:1.5rem">
    <h3 style="color:#38bdf8;margin-bottom:0.75rem">📋 Academic Recommendations</h3>
    <ul class="advice-list">${s.recommendations.map(r =>
      `<li style="font-size:1rem;color:#C4B5FD;margin-bottom:0.4rem">${r}</li>`).join('')}</ul>
    <p style="color:#A8A3B8;font-size:0.95rem;margin-top:0.7rem">Remember, consistent effort and seeking help when needed are keys to improvement. Don't hesitate to reach out to your professors or academic advisors.</p>
  </div>` : '';

  const careerHtml = s.career ? `<div class="card advice-card" style="padding:1.5rem">
    <h3 style="color:#38bdf8;margin-bottom:0.75rem">💼 Career Guidance</h3>
    <div>${s.career.recommended_paths.map(p => `<span class="pathway-tag">${p}</span>`).join('')}</div>
    <div style="font-size:0.95rem;color:#64748b;margin-top:0.5rem">Skills to focus on: ${s.career.suggested_skills.join(', ')}</div>
    <p style="color:#A8A3B8;font-size:0.92rem;margin-top:0.7rem">Explore internships, workshops, and networking opportunities in your field. Your department is here to support your career growth.</p>
  </div>` : '';

  const learningHtml = (s.learning_path||[]).length ? `<div class="card advice-card" style="padding:1.5rem">
    <h3 style="color:#38bdf8;margin-bottom:0.75rem">🛤️ Personalised Learning Path</h3>
    <ol class="advice-list">${s.learning_path.map(step =>
      `<li style="font-size:1rem;color:#C4B5FD;margin-bottom:0.4rem">${step}</li>`).join('')}</ol>
    <p style="color:#A8A3B8;font-size:0.92rem;margin-top:0.7rem">Stay proactive in your studies. Join peer groups, attend tutorials, and use campus resources for extra support.</p>
  </div>` : '';

  const financialHtml = (s.financial_support||[]).length ? `<div class="card advice-card" style="padding:1.5rem">
    <h3 style="color:#38bdf8;margin-bottom:0.75rem">💰 Financial Support &amp; Wellbeing</h3>
    <ul class="advice-list">${s.financial_support.map(f =>
      `<li style="font-size:1rem;color:#C4B5FD;margin-bottom:0.4rem">${f}</li>`).join('')}</ul>
    <p style="color:#A8A3B8;font-size:0.92rem;margin-top:0.7rem">If you face financial or personal challenges, please contact the department office. We can connect you with scholarships, counseling, and support services.</p>
  </div>` : '';

  const resourcesHtml = `<div class="card advice-card resources-card" style="padding:1.5rem">
    <h3 style="color:#38bdf8;margin-bottom:0.3rem">📚 Learning Resources</h3>
    <p style="color:#A8A3B8;font-size:0.9rem;margin-bottom:1rem">${isHighRisk ? '⚠️ As a high-risk student, we strongly encourage you to use these resources to improve your performance.' : 'Explore these platforms to strengthen your academic skills.'}</p>
    <div class="resources-grid">
      <a href="https://www.geeksforgeeks.org" target="_blank" rel="noopener" class="resource-link">
        <span class="resource-icon">🟢</span>
        <div><div class="resource-name">GeeksforGeeks</div><div class="resource-desc">DSA, programming, CS fundamentals</div></div>
      </a>
      <a href="https://www.khanacademy.org" target="_blank" rel="noopener" class="resource-link">
        <span class="resource-icon">🎓</span>
        <div><div class="resource-name">Khan Academy</div><div class="resource-desc">Maths, science, free courses</div></div>
      </a>
      <a href="https://www.coursera.org" target="_blank" rel="noopener" class="resource-link">
        <span class="resource-icon">🌐</span>
        <div><div class="resource-name">Coursera</div><div class="resource-desc">University-level online courses</div></div>
      </a>
      <a href="https://www.edx.org" target="_blank" rel="noopener" class="resource-link">
        <span class="resource-icon">📖</span>
        <div><div class="resource-name">edX</div><div class="resource-desc">Free courses from top universities</div></div>
      </a>
      <a href="https://www.youtube.com/@mitocw" target="_blank" rel="noopener" class="resource-link">
        <span class="resource-icon">▶️</span>
        <div><div class="resource-name">MIT OpenCourseWare</div><div class="resource-desc">Free MIT lecture videos</div></div>
      </a>
      <a href="https://www.w3schools.com" target="_blank" rel="noopener" class="resource-link">
        <span class="resource-icon">💻</span>
        <div><div class="resource-name">W3Schools</div><div class="resource-desc">Web &amp; programming tutorials</div></div>
      </a>
    </div>
    <div class="lms-link-box">
      <span style="font-size:1.8rem">🏫</span>
      <div>
        <div style="font-weight:700;color:#e2e8f0;margin-bottom:0.2rem">University LMS Portal</div>
        <div style="font-size:0.85rem;color:#94a3b8;margin-bottom:0.5rem">Access your course materials, assignments, and grades directly on the LMS.</div>
        <a href="https://lms.university.edu" target="_blank" rel="noopener" class="lms-btn">Open LMS Portal →</a>
      </div>
    </div>
  </div>`;

  document.getElementById('studentAdviceContent').innerHTML =
    `<div style="display:flex;flex-direction:column;gap:1rem;margin:1rem 1.5rem">
      ${adviceIntro}${recsHtml}${careerHtml}${learningHtml}${financialHtml}${resourcesHtml}
    </div>`;
}
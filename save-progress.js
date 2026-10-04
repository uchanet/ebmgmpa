/* CAT progress tools. Runs after the unmodified CAT form; no network or cloud storage. */
(function () {
  'use strict';
  if (window.catProgressReady) return;
  if (typeof D === 'undefined' || typeof persist !== 'function') throw new Error('CAT form is not ready');
  const nativeBoot = boot, nativeShowPage = showPage, nativeLoadFile = loadFile, nativeNewReport = newReport;
  let seen = null, savedAt = null, paused = false, resetting = false, restoring = false;
  const key = () => LSKEY(D.meta.round);
  const metaKey = () => key() + '_progress_ui_v1';
  const read = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const parse = raw => { try { return JSON.parse(raw); } catch (_) { return null; } };
  const activePage = () => document.querySelector('section.page.on')?.dataset.page || 'cover';
  const pageExists = p => Array.from(document.querySelectorAll('#tabs [data-go]')).some(b => b.dataset.go === p);
  const clock = date => new Date(date).toLocaleString('id-ID', {dateStyle:'medium', timeStyle:'medium'});
  seen = read(key());
  const previousUI = parse(read(metaKey()));
  savedAt = Number.isFinite(Date.parse(previousUI?.savedAt)) ? previousUI.savedAt : null;
  clearTimeout(saveTimer);

  const style = document.createElement('style');
  style.textContent = `
    #progressPanel{position:sticky;top:var(--cat-header-height,60px);z-index:40;background:#eef5fb;border-bottom:1px solid #c8dbee;padding:12px 18px;color:#173a63}
    #progressPanel .progress-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
    #progressPanel strong{display:block;font-size:14px;line-height:1.5}
    #progressPanel .progress-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    #progressPanel .progress-note{font-size:12px;line-height:1.5;margin:7px 0 0;color:#46576a}
    #progressPanel #saveStatus{display:block;font-size:12px;line-height:1.5;color:#166534;max-width:600px}
    #progressPanel #saveStatus[data-state=error],#progressPanel #saveStatus[data-state=conflict]{color:#a51d1d}
    #progressPanel #saveStatus[data-state=pending]{color:#85500c}
    #progressPanel .btn{min-height:38px;font-size:13px}
    #progressPanel .btn:focus-visible{outline:3px solid #d97706;outline-offset:2px}
    #progressPanel .primary{background:#1f4e79;color:#fff;font-weight:700}
    #tabs{top:var(--cat-tools-height,180px)}
    #progressConflict[hidden]{display:none}
    #progressConflict{background:#fff8e8;border:1px solid #d6a553;border-radius:8px;padding:10px;margin-top:10px;font-size:13px}
    #progressConflict button{margin:6px 6px 0 0}
    @media(max-width:600px){header.top{gap:6px;padding:8px 12px}header.top .grow{display:none}header.top .btn{font-size:11px;padding:5px 7px}#progressPanel{padding:10px 12px}#progressPanel .progress-controls{gap:5px}#progressPanel .btn{font-size:12px;padding:6px 9px}#progressPanel .progress-note{font-size:11px}}
    @media print{#progressPanel{display:none!important}}
  `;
  document.head.appendChild(style);
  const panel = document.createElement('section');
  panel.id = 'progressPanel'; panel.setAttribute('aria-label', 'Penyimpanan progres'); panel.lang = 'id';
  panel.innerHTML = '<div class="progress-row"><div><strong>Progres pengisian</strong><div id="progressStatusSlot"></div></div><div class="progress-controls"><button type="button" class="btn primary" id="btnSaveProgress">Simpan progres</button></div></div><p class="progress-note">Autosave aktif setelah perubahan. Progres dibuka kembali di browser yang sama. Untuk pindah perangkat, unduh lalu buka cadangan JSON. Data isian tidak dikirim ke GitHub.</p><div id="progressConflict" hidden><b>Ada perubahan dari tab lain.</b> Autosave dijeda agar isian tidak saling menimpa. Unduh cadangan tab ini sebelum memilih versi.<div><button class="btn" id="btnUseLatest">Muat versi terbaru</button><button class="btn" id="btnKeepMine">Gunakan isian tab ini</button></div></div>';
  document.querySelector('header.top').after(panel);
  const status = document.getElementById('saveStatus');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  document.getElementById('progressStatusSlot').appendChild(status);
  const controls = panel.querySelector('.progress-controls');
  const backup = document.getElementById('btnSave');
  backup.removeAttribute('data-i'); backup.textContent = 'Unduh cadangan (.json)';
  backup.title = 'Simpan salinan lengkap semua isian sebagai file JSON'; controls.appendChild(backup);
  const input = document.getElementById('fileLoad'), loadLabel = input.closest('label');
  loadLabel.removeAttribute('data-i');
  Array.from(loadLabel.childNodes).filter(n => n.nodeType === 3).forEach(n => n.remove());
  loadLabel.prepend(document.createTextNode('Buka cadangan')); controls.appendChild(loadLabel);
  loadLabel.tabIndex = 0; loadLabel.setAttribute('role', 'button');
  loadLabel.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  function layout() {
    const h = document.querySelector('header.top').getBoundingClientRect().height;
    document.documentElement.style.setProperty('--cat-header-height', h + 'px');
    document.documentElement.style.setProperty('--cat-tools-height', (h + panel.getBoundingClientRect().height) + 'px');
  }
  if (window.ResizeObserver) { const ro = new ResizeObserver(layout); ro.observe(panel); ro.observe(document.querySelector('header.top')); }
  window.addEventListener('resize', layout); layout();
  function display(message, state) { status.textContent = message; status.dataset.state = state || 'saved'; }
  function saveUI() {
    if (restoring || resetting || paused) return;
    try { localStorage.setItem(metaKey(), JSON.stringify({savedAt, page:activePage(), language:LANG, member:ME})); } catch (_) { /* Core draft remains independent of UI preferences. */ }
  }
  function conflict() {
    paused = true; clearTimeout(saveTimer); document.getElementById('progressConflict').hidden = false;
    display('Belum disimpan: ada perubahan dari tab lain. Pilih versi di bawah.', 'conflict');
    return false;
  }
  persist = function () {
    clearTimeout(saveTimer); saveTimer = null;
    if (resetting || !D.meta.round) return false;
    if (paused) return conflict();
    try {
      const text = JSON.stringify(D), current = localStorage.getItem(key());
      if (current !== seen && current !== text) return conflict();
      localStorage.setItem(key(), text);
      if (localStorage.getItem(key()) !== text) throw new Error('Verification failed');
      seen = text; savedAt = new Date().toISOString(); storageOK = true; dirty = false;
      saveUI(); display('Tersimpan di browser ini - ' + clock(savedAt));
      return true;
    } catch (_) {
      storageOK = false; dirty = true;
      display('Gagal menyimpan di browser. Klik Unduh cadangan untuk mengamankan isian.', 'error');
      return false;
    }
  };
  markDirty = function () {
    dirty = true;
    if (paused) { conflict(); return; }
    display('Ada perubahan - menyimpan otomatis...', 'pending'); scheduleSave();
  };
  showPage = function (p) { nativeShowPage(p); saveUI(); };
  boot = function () {
    const page = activePage(); restoring = true;
    try { nativeBoot(); if (pageExists(page)) nativeShowPage(page); }
    finally { restoring = false; }
    saveUI(); layout();
  };
  document.getElementById('btnSaveProgress').onclick = () => persist();
  backup.onclick = () => {
    persist();
    const stamp = new Date().toISOString().slice(11,19).replace(/:/g, '');
    dl(fileStem() + '_progres_' + stamp + '.json', JSON.stringify(D, null, 2));
  };

  // Validate working-file structure before replacing anything. Keep the original grading schema.
  function normalizedReport(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.meta || !Object.hasOwn(ROUND_INFO, raw.meta.round)) throw new Error('File ini bukan cadangan CAT yang valid.');
    if (raw.schema_version && raw.schema_version !== SCHEMA_VERSION) throw new Error('Versi file cadangan belum didukung.');
    const rows = {
      members:{member_id:'', name:'', email:''},
      databases:{db_id:'', name:'', peer_reviewed:true, language:'', year_range:'', reason:''},
      steps:{no:1, code:'', hits:{}, final_count:0, result_note:'', found_ev_ids:[]},
      evidence:{ev_id:1, band:'', pm:'', lv:'', citation:'', doi:'', comment:'', fulltext_checked:false},
      assessment:{ev_id:1, rd:'', lv:'', picoc_map:{p:'',i:'',o:'',m:'',z:'',c:''}, effect_size:{magnitude:'',details:''}, key_findings:'', policy_implications:''},
      nodes:{node_id:'', label:'', note:''}, links:{from:'',to:'',direction:'+',ev_ids:[],mechanism:''},
      recommendations:recBlank(), actions:{text:'',ev_ids:[]},
      assignments:{unit:'',member_id:'',round:1}, contributions:{unit:'',member_id:'',updated_at:''}
    };
    function safe(v, depth) {
      if (depth > 40) throw new Error('Struktur file terlalu dalam.');
      if (v && typeof v === 'object') Object.keys(v).forEach(k => {
        if (['__proto__','constructor','prototype'].includes(k)) throw new Error('Struktur file tidak aman.');
        safe(v[k], depth + 1);
      });
    }
    safe(raw, 0);
    function fill(template, value, name) {
      if (value === undefined) return JSON.parse(JSON.stringify(template));
      const invalid = () => { throw new Error('Format data tidak valid pada ' + name + '.'); };
      if (value === null && ['group_no','collaboration','final_count'].includes(name)) return null;
      if (template === null) { if (value !== null && typeof value !== 'string') invalid(); return value; }
      if (Array.isArray(template)) {
        if (!Array.isArray(value)) invalid();
        const item = rows[name] || (['ev_ids','found_ev_ids'].includes(name) ? 1 : '');
        return value.map(v => fill(item, v, name + '[]'));
      }
      if (typeof template === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
        if (name === 'hits') {
          Object.values(value).forEach(v => { if (v !== null && (!Number.isFinite(v) || v < 0)) invalid(); });
          return {...value};
        }
        const out = {...value};
        Object.keys(template).forEach(k => out[k] = fill(template[k], value[k], k));
        return out;
      }
      if (typeof value !== typeof template || (typeof value === 'number' && !Number.isFinite(value))) invalid();
      return value;
    }
    const report = fill(blank(), raw, 'report');
    if (!report.meta.members.length) throw new Error('Daftar anggota tidak ada.');
    return report;
  }
  function adopt(report) {
    clearTimeout(saveTimer); D = report; ME = ''; paused = false; dirty = true;
    seen = read(key()); document.getElementById('progressConflict').hidden = true;
    if (!D.collaboration && ROUND_INFO[D.meta.round].group) D.collaboration = {assignments:[],contributions:[]};
    seedRows(); syncAssessment(); boot();
  }
  loadFile = async function (file, fromGate) {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Ukuran cadangan maksimal 10 MB.');
      let raw;
      try { raw = JSON.parse(await file.text()); } catch (_) { throw new Error('File bukan JSON yang valid. Isian saat ini tidak diubah.'); }
      if (raw?.fragment) { nativeLoadFile(file, fromGate); return; }
      const report = normalizedReport(raw);
      if (!confirm('Buka cadangan ini dan ganti seluruh isian saat ini? Batalkan untuk mengunduh cadangan isian sekarang terlebih dahulu.')) return;
      adopt(report);
    } catch (error) { alert(error.message || 'Cadangan gagal dibuka.'); }
    finally { input.value = ''; }
  };
  document.getElementById('btnUseLatest').onclick = () => {
    try {
      const report = normalizedReport(parse(read(key())));
      if (confirm('Ganti isian tab ini dengan versi yang tersimpan? Unduh cadangan tab ini dahulu bila diperlukan.')) adopt(report);
    } catch (_) { alert('Versi tersimpan tidak dapat dibaca. Unduh cadangan isian tab ini.'); }
  };
  document.getElementById('btnKeepMine').onclick = () => {
    if (!confirm('Timpa versi tersimpan dengan isian tab ini?')) return;
    seen = read(key()); paused = false; document.getElementById('progressConflict').hidden = true; persist();
  };
  newReport = function () {
    if (!confirm('Hapus progres CAT ini dari browser dan mulai ulang? Unduh cadangan dahulu bila diperlukan.')) return;
    resetting = true; dirty = false; clearTimeout(saveTimer);
    try { localStorage.removeItem(key()); localStorage.removeItem(metaKey()); } catch (_) { resetting = false; alert('Progres tidak dapat dihapus.'); return; }
    location.reload();
  };
  document.querySelectorAll('#notices button').forEach(b => { if (b.onclick === nativeNewReport) b.onclick = newReport; });
  window.addEventListener('storage', e => {
    if (e.key !== key() || resetting) return;
    if (e.newValue === JSON.stringify(D)) { seen = e.newValue; return; }
    if (e.newValue !== seen) conflict();
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); persist(); }
  });
  const flush = () => { if (dirty && !resetting) persist(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('beforeunload', e => {
    if (resetting) return;
    flush();
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  if (previousUI) {
    restoring = true;
    try {
      if (previousUI.language === 0 || previousUI.language === 1) LANG = previousUI.language;
      if (D.meta.members.some(m => m.member_id === previousUI.member)) ME = previousUI.member;
      nativeBoot();
      if (pageExists(previousUI.page)) nativeShowPage(previousUI.page);
    } finally { restoring = false; }
  }
  if (storageOK) display(savedAt ? 'Tersimpan di browser ini - ' + clock(savedAt) : 'Siap - isian disimpan otomatis di browser ini.');
  else display('Penyimpanan browser tidak tersedia. Gunakan Unduh cadangan.', 'error');
  if (dirty) persist();
  saveUI(); layout(); window.catProgressReady = true;
})();

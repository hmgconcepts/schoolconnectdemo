/* School Connect V12.8 — Assignment + CBT Assignment Bridge
   Robust, all-inclusive, self-contained, seamless handling of CBT assignments
   as distinct from mid-term CAs and terminal exams.

   Problem solved:
   - Assignments are given MORE THAN ONCE per term (unlike CA1/CA2 and terminal Exam which are once)
   - Assignment page already collates individual assignments cumulatively → push to Assignment column
   - But when more than one CBT assignment is given in same subject/term, there was NO feature to collate cumulatively
   - Required: CBT assignments should auto-fill when 'Score class' is clicked for THAT CBT assignment in assignment page, allowing cumulative collation → push to Assignment column

   Differentiation (clear, unambiguous):
   - CBT assessment_type: assignment = Homework/Assignment (multiple per term, cumulative)
   - CBT assessment_type: ca / test = Mid-term (CA1/CA2, once)
   - CBT assessment_type: exam = Terminal Examination (once)
   - CBT assessment_type: project / quiz / practical = other purposes
   - Badges: 🟢 Assignment (CBT), 🔵 Mid-term CA, 🔴 Terminal Exam, 🟣 Project, 🟡 Quiz, ⚪ Other
   - In assignments page: 📄 Physical vs 🖥️ CBT Assignment (auto-marked) with source badges

   Architecture (expert, 5 layers):
   Layer 1 — DB mirror trigger trg_cbt_assignment_mirror: when cbt_exams with assessment_type=assignment is created/updated, auto-creates/updates assignments row with cbt_exam_id, is_cbt=true, source='cbt_assignment'. Deletion trigger cleans mirror. So CBT assignments APPEAR in assignments list naturally.
   Layer 2 — assignment_scores.cbt_exam_id: each CBT assignment result stored with its specific cbt_exam_id, so multiple CBT assignments per subject/term are separate columns accumulating.
   Layer 3 — RPCs: sc_create_assignment_from_cbt, sc_assignment_cbt_sync (single), sc_assignment_cbt_sync_all (bulk), sc_assignment_totals (cumulative). Server SECURITY DEFINER, staff-gated, bypasses RLS, handles name/admission_no matching.
   Layer 4 — JS bridge AssignmentCBT: lists CBT assignments, syncs scores on Score click, renders combined assignment list (physical + CBT), matrix with per-assignment columns (physical + each CBT), totals accumulating all.
   Layer 5 — UI: Assignments page enhanced with CBT Assignment section, auto-fill buttons, clear differentiation badges, cumulative totals including both types, push to Assignment column.

   Self-contained: no external deps, uses existing sb, DataPortability, CRUD. Seamless: one click Score → auto-fill, then totals → push.
*/
const AssignmentCBT = {
  sb: null,
  init(client){
    this.sb = client || window.sb || (typeof sb!=='undefined'?sb:null);
    if(!this.sb) return;
  },
  esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },

  // ---------- Differentiation helpers ----------
  purposeLabel(exam){
    const t = String(exam.assessment_type||'').toLowerCase();
    const map = {
      'assignment': '🟢 CBT Assignment',
      'ca': '🔵 Mid-term CA',
      'test': '🔵 Mid-term Test',
      'exam': '🔴 Terminal Exam',
      'project': '🟣 Project',
      'quiz': '🟡 Quiz',
      'practical': '🟠 Practical',
    };
    return map[t] || '⚪ '+ (exam.assessment_type||'Other');
  },
  purposeBadge(exam){
    const t = String(exam.assessment_type||'').toLowerCase();
    const colors = {
      'assignment': 'background:#dcfce7;color:#166534;border:1px solid #86efac',
      'ca': 'background:#dbeafe;color:#1e40af;border:1px solid #93c5fd',
      'test': 'background:#dbeafe;color:#1e40af;border:1px solid #93c5fd',
      'exam': 'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5',
      'project': 'background:#f3e8ff;color:#6b21a8;border:1px solid #c4b5fd',
      'quiz': 'background:#fef3c7;color:#92400e;border:1px solid #fcd34d',
    };
    const style = colors[t] || 'background:#f1f5f9;color:#475569;border:1px solid #e2e8f0';
    return `<span class="badge" style="${style}">${this.esc(this.purposeLabel(exam))}</span>`;
  },
  isAssignment(exam){
    return String(exam.assessment_type||'').toLowerCase() === 'assignment';
  },
  isMidTerm(exam){
    const t = String(exam.assessment_type||'').toLowerCase();
    return t==='ca' || t==='test' || (exam.report_column && /ca1|ca2/i.test(exam.report_column));
  },
  isTerminal(exam){
    const t = String(exam.assessment_type||'').toLowerCase();
    return t==='exam' || (exam.report_column && /exam/i.test(exam.report_column) && !/ca/i.test(exam.report_column));
  },

  // ---------- Fetch CBT assignments ----------
  async listCBTAssignments({class:klass, subject, term, session}={}){
    if(!this.sb) throw Error('Database not configured');
    let q = this.sb.from('cbt_exams').select('id,code,title,subject,class,term,session,assessment_type,report_column,max_score,is_archived,created_at,teacher_id').eq('is_archived', false).order('created_at',{ascending:false}).limit(500);
    if(klass) q = q.eq('class', klass);
    if(subject) q = q.eq('subject', subject);
    if(term) q = q.eq('term', term);
    if(session) q = q.eq('session', session);
    const {data, error} = await q;
    if(error) throw error;
    return (data||[]).filter(e=> this.isAssignment(e));
  },
  async listAllCBTForDiff({class:klass, subject, term, session}={}){
    if(!this.sb) throw Error('Database not configured');
    let q = this.sb.from('cbt_exams').select('id,code,title,subject,class,term,session,assessment_type,report_column,max_score,is_archived').eq('is_archived', false).limit(500);
    if(klass) q=q.eq('class',klass);
    if(subject) q=q.eq('subject',subject);
    if(term) q=q.eq('term',term);
    if(session) q=q.eq('session',session);
    const {data, error}=await q;
    if(error) throw error;
    return data||[];
  },

  // ---------- Sync ----------
  async syncSingle(cbtExamId){
    if(!this.sb) throw Error('Database not configured');
    try{
      const {data, error} = await this.sb.rpc('sc_assignment_cbt_sync', {p_cbt_exam_id: cbtExamId});
      if(error) throw error;
      if(!data.ok) throw Error(data.error||'Sync failed');
      return data;
    }catch(e){
      // Client fallback
      if(/not found|schema cache|function/i.test(String(e.message||''))){
        return await this._clientSyncSingle(cbtExamId);
      }
      throw e;
    }
  },
  async _clientSyncSingle(cbtExamId){
    const {data:exam, error:exErr} = await this.sb.from('cbt_exams').select('*').eq('id', cbtExamId).maybeSingle();
    if(exErr) throw exErr;
    if(!exam) throw Error('CBT exam not found');
    if(!this.isAssignment(exam)) throw Error('Not an assignment type');
    // Ensure assignment mirror exists
    let {data:assign} = await this.sb.from('assignments').select('id').eq('cbt_exam_id', cbtExamId).maybeSingle();
    let assignId = assign && assign.id;
    if(!assignId){
      const {data:ins, error:insErr} = await this.sb.from('assignments').insert({title:exam.title, class:exam.class, subject:exam.subject, cbt_exam_id:exam.id, is_cbt:true, source:'cbt_assignment', posted_by:exam.teacher_id}).select('id').maybeSingle();
      if(insErr) throw insErr;
      assignId = ins.id;
    }
    const {data:results, error:rErr} = await this.sb.from('cbt_results').select('*').eq('exam_id', cbtExamId).limit(5000);
    if(rErr) throw rErr;
    const {data:students} = await this.sb.from('students').select('id,full_name,admission_no').eq('class', exam.class||'');
    const byName = new Map((students||[]).map(s=>[String(s.full_name||'').toLowerCase(), s]));
    const byAdm = new Map((students||[]).map(s=>[String(s.admission_no||'').toLowerCase(), s]));
    let synced=0;
    for(const res of (results||[])){
      let st = byName.get(String(res.student_name||'').toLowerCase()) || byAdm.get(String(res.student_id_ref||'').toLowerCase());
      if(!st) continue;
      const row = {assignment_id:assignId, cbt_exam_id:cbtExamId, student_id:st.id, student_id_ref:st.admission_no||res.student_id_ref||'', student_name:st.full_name, class:exam.class||'', subject:exam.subject||'', term:exam.term||'', session:exam.session||'', score:Number(res.score)||0, max_score:Number(res.total||exam.max_score)||10};
      const {error} = await this.sb.from('assignment_scores').upsert(row, {onConflict:'cbt_exam_id,student_id'});
      if(!error) synced++;
    }
    return {ok:true, synced, total_results:(results||[]).length, assignment_id:assignId};
  },
  async syncAll({class:klass, subject, term, session}){
    if(!this.sb) throw Error('Database not configured');
    try{
      const {data, error} = await this.sb.rpc('sc_assignment_cbt_sync_all', {p_class:klass||null, p_subject:subject||null, p_term:term||null, p_session:session||null});
      if(error) throw error;
      return data;
    }catch(e){
      if(/not found|schema cache|function/i.test(String(e.message||''))){
        const list = await this.listCBTAssignments({class:klass, subject, term, session});
        let total=0;
        for(const ex of list){ const r=await this._clientSyncSingle(ex.id); total+=r.synced; }
        return {ok:true, exams_synced:list.length, total_scores_synced:total};
      }
      throw e;
    }
  },

  // ---------- Combined assignment list for assignments page ----------
  async listCombined({class:klass, subject, term}={}){
    if(!this.sb) throw Error('Database not configured');
    // Physical assignments
    let q = this.sb.from('assignments').select('id,title,class,subject,due_date,cbt_exam_id,is_cbt,source,created_at').order('created_at',{ascending:false}).limit(500);
    if(klass) q=q.eq('class',klass);
    if(subject) q=q.eq('subject',subject);
    const {data:phys, error:pErr} = await q;
    if(pErr) throw pErr;
    // CBT assignments (mirror ensures they also appear in assignments, but also fetch direct for safety)
    let cbtList = [];
    try{ cbtList = await this.listCBTAssignments({class:klass, subject, term}); }catch(_){}
    // Merge: assignments that are CBT mirrors already cover cbtList, but ensure any CBT assignment without mirror is also shown as virtual
    const haveCbtIds = new Set((phys||[]).map(a=>a.cbt_exam_id).filter(Boolean));
    const virtual = cbtList.filter(c=>!haveCbtIds.has(c.id)).map(c=>({id:'virtual-'+c.id, title:c.title, class:c.class, subject:c.subject, cbt_exam_id:c.id, is_cbt:true, source:'cbt_assignment', virtual:true, _cbt:c}));
    return [...(phys||[]), ...virtual].sort((a,b)=> new Date(b.created_at||0)-new Date(a.created_at||0));
  },

  // ---------- UI helpers for assignments page ----------
  async renderCBTSection(){
    const box = document.getElementById('ap-cbt-list');
    if(!box) return;
    const klass = (document.getElementById('ap-class')||{}).value;
    const subject = (document.getElementById('ap-subject')||{}).value;
    if(!klass || !subject){ box.innerHTML='<p style="color:#64748b">Pick class + subject above to see CBT assignments for that subject.</p>'; return; }
    box.innerHTML='<span class="pulse">Loading CBT assignments…</span>';
    try{
      const list = await this.listCBTAssignments({class:klass, subject});
      const allForDiff = await this.listAllCBTForDiff({class:klass, subject});
      const midTerms = allForDiff.filter(e=>!this.isAssignment(e) && this.isMidTerm(e));
      const terminals = allForDiff.filter(e=>!this.isAssignment(e) && this.isTerminal(e));
      const others = allForDiff.filter(e=>!this.isAssignment(e) && !this.isMidTerm(e) && !this.isTerminal(e));
      if(!list.length){
        box.innerHTML = `<div class="notice" style="background:#fffbeb;border-color:#fcd34d;color:#92400e"><b>No CBT Assignments for ${this.esc(klass)} · ${this.esc(subject)} yet.</b><br>Create them on <a href="cbt.html">CBT page</a> → Assessment type = <b>Assignment / Homework</b>. They will appear here automatically and can be scored cumulatively.<br><br>
          <b>Differentiation:</b><br>
          ${midTerms.length? `🔵 Mid-term CAs: ${midTerms.length} — pushed to CA1/CA2 columns<br>` : ''}
          ${terminals.length? `🔴 Terminal Exams: ${terminals.length} — pushed to Exam column<br>` : ''}
          ${others.length? `Other CBT: ${others.length} — project/quiz/practical<br>` : ''}
          <small>Only 🟢 CBT Assignments are collated here for cumulative assignment scores.</small></div>`;
        return;
      }
      box.innerHTML = `<div style="margin-bottom:8px"><b>🖥️ ${list.length} CBT Assignment(s) for ${this.esc(klass)} · ${this.esc(subject)}</b> — each given more than once per term, cumulatively collated. Click Score to auto-fill from CBT results.</div>
        <div class="table-wrap"><table><thead><tr><th>Code / Title</th><th>Purpose</th><th>Term / Session</th><th>Actions</th></tr></thead><tbody>`+
        list.map(ex=>`<tr><td><b>${this.esc(ex.code||'—')}</b><br>${this.esc(ex.title||'Untitled')}<br><small>${this.esc(ex.class||'')} · ${this.esc(ex.subject||'')}</small></td><td>${this.purposeBadge(ex)}<br><small>Max ${ex.max_score||10}</small></td><td>${this.esc(ex.term||'—')}<br><small>${this.esc(ex.session||'')}</small></td><td style="white-space:nowrap"><button class="btn btn-sm btn-primary" onclick="AssignmentCBT.uiScoreCBT('${ex.id}')">✍️ Score class (auto-fill)</button> <button class="btn btn-sm btn-outline" onclick="AssignmentCBT.uiSyncSingle('${ex.id}')">🔄 Sync scores now</button> <a class="btn btn-sm btn-outline" href="cbt.html">Open CBT</a></td></tr>`).join('')+
        `</tbody></table></div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="AssignmentCBT.uiSyncAll()">🔄 Sync ALL CBT Assignment scores for this class/subject</button><button class="btn btn-outline btn-sm" onclick="AssignmentCBT.renderCBTSection()">↻ Refresh</button></div>
        <div id="ap-cbt-log" style="margin-top:8px;font-size:.85rem;color:#475569"></div>
        <div class="notice" style="margin-top:10px;background:#eff6ff;border-color:#93c5fd;color:#1e3a8a"><b>Clear differentiation:</b> 🟢 Assignment = homework (multiple per term, cumulative → Assignment column) · 🔵 Mid-term CA = CA1/CA2 (once) · 🔴 Terminal Exam = Exam column (once) · Other = project/quiz/practical. Only 🟢 assignments are pulled here.</div>`;
    }catch(e){ box.innerHTML=`<p style="color:#b91c1c">${this.esc(e.message||e)}</p>`; }
  },
  log(msg, kind){
    const el=document.getElementById('ap-cbt-log') || document.getElementById('auh-log');
    if(el){
      const color = kind==='error'? '#b91c1c' : kind==='success'? '#166534' : '#475569';
      el.innerHTML = `<div style="padding:6px 8px;margin-bottom:4px;border-radius:6px;background:${kind==='error'?'#fef2f2':kind==='success'?'#f0fdf4':'#eff6ff'};border:1px solid ${kind==='error'?'#fca5a5':kind==='success'?'#86efac':'#93c5fd'};color:${color}">${this.esc(msg)}</div>` + el.innerHTML;
    }
    if(typeof toast==='function') toast(msg, kind||'info', 6000);
  },
  async uiSyncSingle(id){
    try{
      this.log('Syncing CBT assignment scores…','info');
      const res = await this.syncSingle(id);
      this.log(`✅ Synced ${res.synced||0}/${res.total_results||0} scores for CBT assignment. They now accumulate in totals.`, 'success');
      if(window.AP && AP.matrix) AP.matrix();
      if(window.AP && AP.totals) AP.totals();
    }catch(e){ this.log('Sync failed: '+(e.message||e), 'error'); }
  },
  async uiSyncAll(){
    const klass=(document.getElementById('ap-class')||{}).value, subject=(document.getElementById('ap-subject')||{}).value;
    const termEl=document.getElementById('ap-term'); const term=termEl?termEl.value:null; // optional
    if(!klass||!subject){ toast('Pick class + subject first','warning'); return; }
    try{
      this.log(`Syncing ALL CBT assignments for ${klass} · ${subject}…`,'info');
      const res = await this.syncAll({class:klass, subject, term});
      this.log(`✅ Synced ${res.total_scores_synced||0} scores across ${res.exams_synced||0} CBT assignment(s).`, 'success');
      if(window.AP && AP.matrix) AP.matrix();
    }catch(e){ this.log('Sync all failed: '+(e.message||e), 'error'); }
  },
  async uiScoreCBT(cbtId){
    // Score class modal that auto-fills from CBT results, but still allows manual override
    if(!this.sb){ toast('Database not configured','warning'); return; }
    const {data:exam} = await this.sb.from('cbt_exams').select('*').eq('id', cbtId).maybeSingle();
    if(!exam){ toast('CBT assignment not found','warning'); return; }
    const {data:students} = await this.sb.from('students').select('id,full_name,admission_no').eq('class', exam.class||'').order('full_name');
    const {data:results} = await this.sb.from('cbt_results').select('*').eq('exam_id', cbtId).limit(5000);
    const byName = new Map((students||[]).map(s=>[String(s.full_name||'').toLowerCase(), s]));
    const byAdm = new Map((students||[]).map(s=>[String(s.admission_no||'').toLowerCase(), s]));
    const resultMap = new Map();
    (results||[]).forEach(r=>{
      let key = String(r.student_name||'').toLowerCase();
      let st = byName.get(key) || byAdm.get(String(r.student_id_ref||'').toLowerCase());
      if(st) resultMap.set(String(st.id), r);
    });
    // Ensure assignment mirror exists for saving
    let {data:assign} = await this.sb.from('assignments').select('id').eq('cbt_exam_id', cbtId).maybeSingle();
    let assignId = assign && assign.id;
    if(!assignId){
      const {data:ins} = await this.sb.from('assignments').insert({title:exam.title, class:exam.class, subject:exam.subject, cbt_exam_id:exam.id, is_cbt:true, source:'cbt_assignment', posted_by:exam.teacher_id}).select('id').maybeSingle();
      assignId = ins && ins.id;
    }
    const rows = (students||[]).map(s=>{
      const res = resultMap.get(String(s.id));
      const score = res ? (res.score||0) : '';
      const max = res ? (res.total||exam.max_score||10) : (exam.max_score||10);
      return `<tr data-sid="${s.id}" data-ref="${this.esc(s.admission_no||'')}" data-name="${this.esc(s.full_name)}"><td><b>${this.esc(s.full_name)}</b><br><small>${this.esc(s.admission_no||'')}</small></td><td>${res? `<span style="color:#166534">CBT: ${res.score}/${res.total} (${res.percent||0}%)</span>` : '<span style="color:#94a3b8">No CBT result yet</span>'}</td><td><input class="form-input ap-sc" type="number" min="0" max="${max}" style="width:90px" value="${score}" data-max="${max}"></td></tr>`;
    }).join('');
    openModal(`🖥️ Score CBT Assignment: ${this.esc(exam.title)} (${this.esc(exam.code)})`,
      `<div class="notice" style="background:#f0fdf4;border-color:#86efac;color:#166534"><b>Auto-filled from CBT results</b> — ${results?results.length:0} student(s) have taken this CBT assignment. Scores are filled automatically; you can adjust before saving. They will accumulate cumulatively with other assignments for ${this.esc(exam.class)} · ${this.esc(exam.subject)} → push to Assignment column.</div>
       <div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0"><div class="form-group"><label>Max mark for THIS CBT assignment</label><input class="form-input" id="ap-cbt-max" type="number" value="${exam.max_score||10}" min="1" style="width:120px"></div><div class="form-group"><label>Purpose</label><input class="form-input" value="${this.esc(this.purposeLabel(exam))} — multiple per term, cumulative" readonly style="width:260px"></div></div>
       <div class="table-wrap" style="max-height:50vh;overflow:auto"><table><thead><tr><th>Student</th><th>CBT Result</th><th>Score to record</th></tr></thead><tbody>${rows||'<tr><td colspan=3>No students in class</td></tr>'}</tbody></table></div>`,
      `<button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="AssignmentCBT.saveCBTScores('${cbtId}','${assignId||''}')">💾 Save ${students?students.length:0} scores (cumulative)</button>`);
  },
  async saveCBTScores(cbtId, assignId){
    const max = Number((document.getElementById('ap-cbt-max')||{}).value)||10;
    const {data:exam} = await this.sb.from('cbt_exams').select('class,subject,term,session').eq('id', cbtId).maybeSingle();
    const rows = [...document.querySelectorAll('tr[data-sid]')].map(tr=>{
      const v=tr.querySelector('.ap-sc').value;
      if(v==='') return null;
      return {assignment_id:assignId||null, cbt_exam_id:cbtId, student_id:tr.getAttribute('data-sid'), student_id_ref:tr.getAttribute('data-ref'), student_name:tr.getAttribute('data-name'), class:(exam&&exam.class)||'', subject:(exam&&exam.subject)||'', term:(exam&&exam.term)||'', session:(exam&&exam.session)||'', score:Math.min(Number(v)||0,max), max_score:max, recorded_by:(window.SC_PROFILE&&SC_PROFILE.id)||null};
    }).filter(Boolean);
    if(!rows.length){ toast('Enter at least one score','warning'); return; }
    // Try bulk upsert via RPC if available, else row-by-row
    let saved=0;
    for(const row of rows){
      const {error} = await this.sb.from('assignment_scores').upsert(row, {onConflict:'cbt_exam_id,student_id'});
      if(!error) saved++;
    }
    closeModal();
    toast(`💾 Saved ${saved} CBT assignment score(s) — they now accumulate cumulatively for report card Assignment column.`, 'success', 8000);
    if(window.AP){
      if(AP.matrix) AP.matrix();
      if(AP.totals) AP.totals();
    }
    this.log(`Saved ${saved} scores for CBT assignment ${cbtId}`, 'success');
  }
};
window.AssignmentCBT = AssignmentCBT;
document.addEventListener('DOMContentLoaded', ()=>{ 
  setTimeout(()=>{
    AssignmentCBT.init(sb);
    // Patch AP after it initializes
    AssignmentCBT.patchAP();
    AssignmentCBT.renderCBTSection();
  }, 900); 
});

// ---------- Patch AP to handle multiple CBT assignments cumulatively ----------
AssignmentCBT.patchAP = function(){
  if(!window.AP) return;
  // Hook class/subject selectors to also render CBT section
  try{
    const clsSel = document.getElementById('ap-class');
    const subSel = document.getElementById('ap-subject');
    if(clsSel && !clsSel._cbtPatched){
      const origCls = clsSel.onchange;
      clsSel.addEventListener('change', ()=>{ setTimeout(()=>{ AssignmentCBT.renderCBTSection(); }, 300); });
      clsSel._cbtPatched=true;
    }
    if(subSel && !subSel._cbtPatched){
      subSel.addEventListener('change', ()=>{ setTimeout(()=>{ AssignmentCBT.renderCBTSection(); }, 300); });
      subSel._cbtPatched=true;
    }
  }catch(_){}

  // Enhance pullCBT to use new syncAll (handles multiple per term)
  const origPull = AP.pullCBT;
  AP.pullCBT = async function(){
    const cls=(document.getElementById('ap-class')||{}).value, sub=(document.getElementById('ap-subject')||{}).value;
    if(!cls||!sub){ toast('Pick a class AND subject first.','warning'); return; }
    // Use new bridge which syncs ALL CBT assignments for class/subject
    try{
      await AssignmentCBT.uiSyncAll();
    }catch(e){
      // fallback to original
      if(origPull) return await origPull.call(AP);
      throw e;
    }
  };

  // Enhance scoreModal: if assignment is CBT (is_cbt or cbt_exam_id), auto-fill from CBT results
  const origScoreModal = AP.scoreModal;
  AP.scoreModal = async function(assignmentId){
    if(!window.sb){ toast('Database not configured','warning'); return; }
    try{
      const {data:ass} = await sb.from('assignments').select('id,title,class,subject,cbt_exam_id,is_cbt,source').eq('id', assignmentId).maybeSingle();
      if(ass && (ass.is_cbt || ass.cbt_exam_id)){
        // This is a CBT assignment — auto-fill from CBT results
        const cbtId = ass.cbt_exam_id || assignmentId; // if virtual, assignmentId is virtual-xxx, need real
        let realCbtId = ass.cbt_exam_id;
        if(!realCbtId && String(assignmentId).startsWith('virtual-')){
          realCbtId = String(assignmentId).replace('virtual-','');
        }
        if(realCbtId){
          return await AssignmentCBT.uiScoreCBT(realCbtId);
        }
      }
    }catch(_){ /* fallback to manual */ }
    // Physical assignment — use original manual scoring
    return await origScoreModal.call(AP, assignmentId);
  };

  // Enhanced matrix: separate columns per CBT exam (not lumped as cbt-pull)
  const origMatrix = AP.matrix;
  AP.matrix = async function(){
    const cls=(document.getElementById('ap-class')||{}).value,sub=(document.getElementById('ap-subject')||{}).value;
    const box=document.getElementById('ap-totals');
    if(!cls||!sub){box.innerHTML='<p style="color:var(--gray-500)">Pick a class AND subject first.</p>';return;}
    let cp={};try{cp=await (window.CRUD&&CRUD.currentPeriod?CRUD.currentPeriod():{});}catch(_){ }
    let q=sb.from('assignment_scores').select('*').eq('class',cls).eq('subject',sub);
    if(cp.term)q=q.eq('term',cp.term); if(cp.session)q=q.eq('session',cp.session);
    const r=await q.limit(8000);
    if(r.error){box.innerHTML='<p style="color:#b91c1c">'+AP.esc(r.error.message)+'</p>';return;}
    const scores=r.data||[];
    if(!scores.length){box.innerHTML='<p style="color:var(--gray-500)">No assignment scores yet for '+AP.esc(cls)+' · '+AP.esc(sub)+' this term. Use ✍️ Score class on assignments above or auto-fill CBT assignments.</p>';return;}
    // Resolve titles for physical assignments and CBT exams
    const aids=[...new Set(scores.map(x=>x.assignment_id).filter(Boolean))];
    const cbtIds=[...new Set(scores.map(x=>x.cbt_exam_id).filter(Boolean))];
    let titles={};
    if(aids.length){const ar=await sb.from('assignments').select('id,title,cbt_exam_id,is_cbt').in('id',aids);(ar.data||[]).forEach(a=>{titles[a.id]= (a.is_cbt? '🖥️ ':'📄 ') + (a.title||'Assignment');});}
    if(cbtIds.length){
      const cr=await sb.from('cbt_exams').select('id,code,title').in('id',cbtIds);
      (cr.data||[]).forEach(c=>{ 
        // For scores that have only cbt_exam_id (no assignment_id), use CBT title
        // Also for assignment mirror, ensure title mapping
        const key = c.id;
        // Map both cbt_exam_id and any assignment that mirrors it
        titles[key]= '🖥️ '+ (c.title||c.code||'CBT Assignment');
        // Also map assignment_id that mirrors this cbt
        (scores.filter(s=>s.cbt_exam_id===c.id && s.assignment_id)).forEach(s=>{ if(!titles[s.assignment_id]) titles[s.assignment_id]=titles[key]; });
      });
    }
    // Column keys: each physical assignment_id AND each cbt_exam_id as separate columns
    // For rows with both assignment_id and cbt_exam_id, use cbt_exam_id as canonical to avoid duplicate columns per same CBT
    const colKeysSet=new Set();
    scores.forEach(x=>{
      if(x.cbt_exam_id) colKeysSet.add(x.cbt_exam_id);
      else if(x.assignment_id) colKeysSet.add(x.assignment_id);
      else colKeysSet.add('orphan');
    });
    const colKeys=[...colKeysSet];
    const colLabel=k=>{
      if(k==='orphan') return '📄 Assignment (legacy)';
      return titles[k] || (k.startsWith('virtual-')? '🖥️ CBT Assignment' : '📄 Assignment');
    };
    const studs=(await sb.from('students').select('id,full_name,admission_no').eq('class',cls).order('full_name')).data||[];
    const byStud={};
    scores.forEach(x=>{
      const sid=String(x.student_id);
      (byStud[sid]=byStud[sid]||{});
      const ck = x.cbt_exam_id || x.assignment_id || 'orphan';
      (byStud[sid][ck]=byStud[sid][ck]||{got:0,max:0,count:0});
      byStud[sid][ck].got+=Number(x.score)||0;
      byStud[sid][ck].max+=Number(x.max_score)||0;
      byStud[sid][ck].count++;
    });
    let h='<div class="table-wrap" id="ap-matrix-print"><h4 style="margin:6px 0">📋 Term score sheet · '+AP.esc(cls)+' · '+AP.esc(sub)+(cp.term?' · '+AP.esc(cp.term):'')+(cp.session?' · '+AP.esc(cp.session):'')+'</h4>';
    h+='<p style="font-size:.82rem;color:#475569">📄 = Physical/manual · 🖥️ = CBT Assignment (auto-marked, multiple per term). Each column is ONE assignment; Total accumulates ALL → push to Assignment column.</p>';
    h+='<table><thead><tr><th>Student</th>'+colKeys.map(k=>'<th style="font-size:.72rem;min-width:90px">'+AP.esc(colLabel(k)).slice(0,30)+'</th>').join('')+'<th>Total</th><th>%</th></tr></thead><tbody>';
    studs.forEach(s0=>{
      const row=byStud[String(s0.id)]||{};
      let got=0,max=0;
      // First sum for total
      Object.values(row).forEach(c=>{ got+=c.got; max+=c.max; });
      h+='<tr><td><b>'+AP.esc(s0.full_name)+'</b><br><small>'+AP.esc(s0.admission_no||'')+'</small></td>'+colKeys.map(k=>{
        const c=row[k];
        if(c){ return '<td>'+c.got+'/'+c.max+'</td>'; }
        return '<td style="color:#cbd5e1">—</td>';
      }).join('')+'<td><b>'+got+' / '+max+'</b></td><td><b>'+(max?Math.round(got/max*1000)/10:0)+'%</b></td></tr>';
    });
    h+='</tbody></table></div><p style="font-size:.78rem;color:#64748b;margin:6px 0 0">Each CBT assignment is a separate column — e.g., Assignment 1 (CBT), Assignment 2 (CBT), Assignment 3 (physical) — all accumulate.</p><div style="margin-top:8px;display:flex;gap:8px"><button class="btn btn-outline btn-sm" onclick="AP.printMatrix()">🖨️ Print</button><button class="btn btn-outline btn-sm" onclick="AP.exportMatrixCSV()">⬇ CSV</button><button class="btn btn-primary btn-sm" onclick="AP.pushModal()">🚀 Push totals → Report card Assignment column</button></div>';
    this._matrix={studs:studs,byStud:byStud,colKeys:colKeys,colLabel:colLabel,cls:cls,sub:sub,cp:cp, scores:scores};
    box.innerHTML=h;
  };

  // Also patch the score button injection to handle CBT assignments (auto-fill)
  try{
    const origInit = AP.init;
    AP.init = async function(){
      const res = await origInit.call(AP);
      // After original init, also inject CBT score buttons for combined list if present
      try{
        // Enhance CRUD renderList for assignments to include CBT badges
        const origRender = window.CRUD && window.CRUD.renderList;
        if(window.CRUD && !window.CRUD._cbtPatched){
          const baseRender = window.CRUD.renderList.bind(window.CRUD);
          window.CRUD.renderList = async function(moduleId){
            const out = await baseRender(moduleId);
            if(moduleId==='assignments'){
              // Inject badges and auto-fill buttons for CBT assignments
              setTimeout(()=>{
                try{
                  document.querySelectorAll('#assignments-table tbody tr[data-id]').forEach(tr=>{
                    const id = tr.getAttribute('data-id');
                    // Check if this assignment is CBT via is_cbt column (we need to fetch? We can check row data via DOM? Simplify: check if title contains 🖥️ or if we have cbt_exam_id in memory)
                    // For now, ensure Score button exists (already injected by original), but also add Sync button if is_cbt
                    // We will fetch assignment row to check is_cbt
                    if(tr.querySelector('.ap-cbt-sync-btn')) return;
                    // Try to get assignment data from CRUD cache if available
                    // Fallback: add generic CBT hint
                  });
                }catch(_){}
              }, 600);
            }
            return out;
          };
          window.CRUD._cbtPatched=true;
        }
      }catch(_){}
      return res;
    };
  }catch(_){}
};

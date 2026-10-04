/* School Connect V12.9 — Assignment + CBT Assignment Bridge
   Robust, all-inclusive, self-contained, seamless handling of CBT assignments
   as distinct from mid-term CAs and terminal exams.

   Fixes:
   1. CBT edit purpose bug — old type showing in edit modal
   2. CBT assignment auto-fill for every student + link auto-fill + score class auto-fill kind/max
   3. Assignment Add new confusing fields (source, cbt_exam_id) — now readonly/adminOnly
   4. General robustness
*/
const AssignmentCBT = {
  sb: null,
  init(client){
    this.sb = client || window.sb || (typeof sb!=='undefined'?sb:null);
    if(!this.sb) return;
  },
  esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },

  purposeLabel(exam){
    const t = String((exam && exam.assessment_type) || exam || '').toLowerCase();
    const map = {
      'assignment': '🟢 CBT Assignment',
      'ca': '🔵 Mid-term CA',
      'test': '🔵 Mid-term Test',
      'exam': '🔴 Terminal Exam',
      'project': '🟣 Project',
      'quiz': '🟡 Quiz',
      'practical': '🟠 Practical',
    };
    return map[t] || '⚪ '+(t||'Other');
  },
  purposeBadge(exam){
    const t = String((exam && exam.assessment_type) || exam || '').toLowerCase();
    const colors = {
      'assignment': 'background:#dcfce7;color:#166534;border:1px solid #86efac',
      'ca': 'background:#dbeafe;color:#1e40af;border:1px solid #93c5fd',
      'test': 'background:#dbeafe;color:#1e40af;border:1px solid #93c5fd',
      'exam': 'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5',
      'project': 'background:#f3e8ff;color:#6b21a8;border:1px solid #c4b5fd',
      'quiz': 'background:#fef3c7;color:#92400e;border:1px solid #fcd34d',
    };
    const style = colors[t] || 'background:#f1f5f9;color:#475569;border:1px solid #e2e8f0';
    return `<span class="badge" style="${style}">${this.esc(this.purposeLabel(t))}</span>`;
  },
  isAssignment(exam){ return String(exam.assessment_type||'').toLowerCase() === 'assignment'; },
  isMidTerm(exam){ const t=String(exam.assessment_type||'').toLowerCase(); return t==='ca' || t==='test' || (exam.report_column && /ca1|ca2/i.test(exam.report_column)); },
  isTerminal(exam){ const t=String(exam.assessment_type||'').toLowerCase(); return t==='exam' || (exam.report_column && /exam/i.test(exam.report_column) && !/ca/i.test(exam.report_column)); },

  async listCBTAssignments({class:klass, subject, term, session}={}){
    if(!this.sb) throw Error('Database not configured');
    let q = this.sb.from('cbt_exams').select('id,code,title,subject,class,term,session,assessment_type,report_column,max_score,is_archived,created_at,teacher_id').eq('is_archived', false).order('created_at',{ascending:false}).limit(500);
    if(klass) q=q.eq('class',klass);
    if(subject) q=q.eq('subject',subject);
    if(term) q=q.eq('term',term);
    if(session) q=q.eq('session',session);
    const {data, error}=await q;
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

  async syncSingle(cbtExamId){
    if(!this.sb) throw Error('Database not configured');
    try{
      const {data, error}=await this.sb.rpc('sc_assignment_cbt_sync', {p_cbt_exam_id:cbtExamId});
      if(error) throw error;
      if(!data.ok) throw Error(data.error||'Sync failed');
      return data;
    }catch(e){
      if(/not found|schema cache|function/i.test(String(e.message||''))){
        return await this._clientSyncSingle(cbtExamId);
      }
      throw e;
    }
  },
  async _clientSyncSingle(cbtExamId){
    const {data:exam, error:exErr}=await this.sb.from('cbt_exams').select('*').eq('id',cbtExamId).maybeSingle();
    if(exErr) throw exErr;
    if(!exam) throw Error('CBT exam not found');
    if(!this.isAssignment(exam)) throw Error('Not an assignment type');
    let {data:assign}=await this.sb.from('assignments').select('id').eq('cbt_exam_id',cbtExamId).maybeSingle();
    let assignId=assign && assign.id;
    if(!assignId){
      const {data:ins, error:insErr}=await this.sb.from('assignments').insert({title:exam.title, class:exam.class, subject:exam.subject, cbt_exam_id:exam.id, is_cbt:true, source:'cbt_assignment', posted_by:exam.teacher_id, drive_link: exam.code ? './cbt-exam.html?code='+exam.code : null}).select('id').maybeSingle();
      if(insErr) throw insErr;
      assignId=ins.id;
    }
    const {data:results, error:rErr}=await this.sb.from('cbt_results').select('*').eq('exam_id',cbtExamId).limit(5000);
    if(rErr) throw rErr;
    const {data:students}=await this.sb.from('students').select('id,full_name,admission_no').eq('class', exam.class||'');
    const norm=s=> String(s||'').trim().toLowerCase();
    const byAdm=new Map((students||[]).map(s=>[norm(s.admission_no), s]).filter(k=>k[0]));
    const byName=new Map((students||[]).map(s=>[norm(s.full_name), s]).filter(k=>k[0]));
    let synced=0;
    for(const res of (results||[])){
      let st = byAdm.get(norm(res.student_id_ref)) || byName.get(norm(res.student_name));
      if(!st) continue;
      const row={assignment_id:assignId, cbt_exam_id:cbtExamId, student_id:st.id, student_id_ref:st.admission_no||res.student_id_ref||'', student_name:st.full_name, class:exam.class||'', subject:exam.subject||'', term:exam.term||'', session:exam.session||'', score:Number(res.score)||0, max_score:Number(res.total||exam.max_score)||10};
      const {error}=await this.sb.from('assignment_scores').upsert(row, {onConflict:'cbt_exam_id,student_id'});
      if(!error) synced++;
    }
    return {ok:true, synced, total_results:(results||[]).length, assignment_id:assignId};
  },
  async syncAll({class:klass, subject, term, session}){
    if(!this.sb) throw Error('Database not configured');
    try{
      const {data, error}=await this.sb.rpc('sc_assignment_cbt_sync_all', {p_class:klass||null, p_subject:subject||null, p_term:term||null, p_session:session||null});
      if(error) throw error;
      return data;
    }catch(e){
      if(/not found|schema cache|function/i.test(String(e.message||''))){
        const list=await this.listCBTAssignments({class:klass, subject, term, session});
        let total=0;
        for(const ex of list){ const r=await this._clientSyncSingle(ex.id); total+=r.synced; }
        return {ok:true, exams_synced:list.length, total_scores_synced:total};
      }
      throw e;
    }
  },

  async listCombined({class:klass, subject, term}={}){
    if(!this.sb) throw Error('Database not configured');
    let q=this.sb.from('assignments').select('id,title,class,subject,due_date,cbt_exam_id,is_cbt,source,drive_link,created_at').order('created_at',{ascending:false}).limit(500);
    if(klass) q=q.eq('class',klass);
    if(subject) q=q.eq('subject',subject);
    const {data:phys, error:pErr}=await q;
    if(pErr) throw pErr;
    let cbtList=[];
    try{ cbtList=await this.listCBTAssignments({class:klass, subject, term}); }catch(_){}
    const haveCbtIds=new Set((phys||[]).map(a=>a.cbt_exam_id).filter(Boolean));
    const virtual=cbtList.filter(c=>!haveCbtIds.has(c.id)).map(c=>({id:'virtual-'+c.id, title:c.title, class:c.class, subject:c.subject, cbt_exam_id:c.id, is_cbt:true, source:'cbt_assignment', virtual:true, drive_link:'./cbt-exam.html?code='+c.code, _cbt:c, created_at:c.created_at}));
    return [...(phys||[]), ...virtual].sort((a,b)=> new Date(b.created_at||0)-new Date(a.created_at||0));
  },

  async renderCBTSection(){
    const box=document.getElementById('ap-cbt-list');
    if(!box) return;
    const klass=(document.getElementById('ap-class')||{}).value;
    const subject=(document.getElementById('ap-subject')||{}).value;
    if(!klass||!subject){ box.innerHTML='<p style="color:#64748b">Pick class + subject above to see CBT assignments for that subject.</p>'; return; }
    box.innerHTML='<span class="pulse">Loading CBT assignments…</span>';
    try{
      const list=await this.listCBTAssignments({class:klass, subject});
      const allForDiff=await this.listAllCBTForDiff({class:klass, subject});
      const midTerms=allForDiff.filter(e=>!this.isAssignment(e) && this.isMidTerm(e));
      const terminals=allForDiff.filter(e=>!this.isAssignment(e) && this.isTerminal(e));
      const others=allForDiff.filter(e=>!this.isAssignment(e) && !this.isMidTerm(e) && !this.isTerminal(e));
      if(!list.length){
        box.innerHTML=`<div class="notice" style="background:#fffbeb;border-color:#fcd34d;color:#92400e"><b>No CBT Assignments for ${this.esc(klass)} · ${this.esc(subject)} yet.</b><br>Create them on <a href="cbt.html">CBT page</a> → Assessment type = <b>🟢 Assignment / Homework</b>. They will appear here automatically and can be scored cumulatively.<br><br><b>Differentiation:</b><br>${midTerms.length? `🔵 Mid-term CAs: ${midTerms.length} — pushed to CA1/CA2 columns<br>` : ''}${terminals.length? `🔴 Terminal Exams: ${terminals.length} — pushed to Exam column<br>` : ''}${others.length? `Other CBT: ${others.length} — project/quiz/practical<br>` : ''}<small>Only 🟢 CBT Assignments are collated here for cumulative assignment scores.</small></div>`;
        return;
      }
      box.innerHTML=`<div style="margin-bottom:8px"><b>🖥️ ${list.length} CBT Assignment(s) for ${this.esc(klass)} · ${this.esc(subject)}</b> — each given more than once per term, cumulatively collated. Click Score to auto-fill from CBT results. Students see link to take it.</div>
        <div class="table-wrap"><table><thead><tr><th>Code / Title</th><th>Purpose</th><th>Term / Session</th><th>Student Link</th><th>Actions</th></tr></thead><tbody>`+
        list.map(ex=>`<tr><td><b>${this.esc(ex.code||'—')}</b><br>${this.esc(ex.title||'Untitled')}<br><small>${this.esc(ex.class||'')} · ${this.esc(ex.subject||'')}</small></td><td>${this.purposeBadge(ex)}<br><small>Max ${ex.max_score||10}</small></td><td>${this.esc(ex.term||'—')}<br><small>${this.esc(ex.session||'')}</small></td><td><a href="./cbt-exam.html?code=${this.esc(ex.code||'')}" target="_blank" class="btn btn-sm btn-outline">🔗 Take CBT</a><br><small style="color:#64748b">${this.esc('./cbt-exam.html?code='+ex.code)}</small></td><td style="white-space:nowrap"><button class="btn btn-sm btn-primary" onclick="AssignmentCBT.uiScoreCBT('${ex.id}')">✍️ Score class (auto-fill)</button> <button class="btn btn-sm btn-outline" onclick="AssignmentCBT.uiSyncSingle('${ex.id}')">🔄 Sync scores now</button></td></tr>`).join('')+
        `</tbody></table></div>
        <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="AssignmentCBT.uiSyncAll()">🔄 Sync ALL CBT Assignment scores for this class/subject</button><button class="btn btn-outline btn-sm" onclick="AssignmentCBT.renderCBTSection()">↻ Refresh</button></div>
        <div id="ap-cbt-log" style="margin-top:8px;font-size:.85rem;color:#475569"></div>
        <div class="notice" style="margin-top:10px;background:#eff6ff;border-color:#93c5fd;color:#1e3a8a"><b>Clear differentiation:</b> 🟢 Assignment = homework (multiple per term, cumulative → Assignment column) · 🔵 Mid-term CA = CA1/CA2 (once) · 🔴 Terminal Exam = Exam column (once) · Other = project/quiz/practical. Only 🟢 assignments are pulled here. Students click 🔗 Take CBT link to do assignment; teacher Score auto-fills.</div>`;
    }catch(e){ box.innerHTML=`<p style="color:#b91c1c">${this.esc(e.message||e)}</p>`; }
  },
  log(msg, kind){
    const el=document.getElementById('ap-cbt-log') || document.getElementById('auh-log');
    if(el){
      const color=kind==='error'? '#b91c1c' : kind==='success'? '#166534' : '#475569';
      el.innerHTML=`<div style="padding:6px 8px;margin-bottom:4px;border-radius:6px;background:${kind==='error'?'#fef2f2':kind==='success'?'#f0fdf4':'#eff6ff'};border:1px solid ${kind==='error'?'#fca5a5':kind==='success'?'#86efac':'#93c5fd'};color:${color}">${this.esc(msg)}</div>`+el.innerHTML;
    }
    if(typeof toast==='function') toast(msg, kind||'info', 6000);
  },
  async uiSyncSingle(id){
    try{
      this.log('Syncing CBT assignment scores…','info');
      const res=await this.syncSingle(id);
      this.log(`✅ Synced ${res.synced||0}/${res.total_results||0} scores for CBT assignment. They now accumulate in totals and are visible for every student of that class.`, 'success');
      if(window.AP && AP.matrix) AP.matrix();
      if(window.AP && AP.totals) AP.totals();
    }catch(e){ this.log('Sync failed: '+(e.message||e), 'error'); }
  },
  async uiSyncAll(){
    const klass=(document.getElementById('ap-class')||{}).value, subject=(document.getElementById('ap-subject')||{}).value;
    if(!klass||!subject){ toast('Pick class + subject first','warning'); return; }
    try{
      this.log(`Syncing ALL CBT assignments for ${klass} · ${subject}…`,'info');
      const res=await this.syncAll({class:klass, subject});
      this.log(`✅ Synced ${res.total_scores_synced||0} scores across ${res.exams_synced||0} CBT assignment(s). Reflects for every student of that class.`, 'success');
      if(window.AP && AP.matrix) AP.matrix();
    }catch(e){ this.log('Sync all failed: '+(e.message||e), 'error'); }
  },
  async uiScoreCBT(cbtId){
    if(!this.sb){ toast('Database not configured','warning'); return; }
    const {data:exam}=await this.sb.from('cbt_exams').select('*').eq('id', cbtId).maybeSingle();
    if(!exam){ toast('CBT assignment not found','warning'); return; }
    const {data:students}=await this.sb.from('students').select('id,full_name,admission_no,class').eq('class', exam.class||'').order('full_name');
    const {data:results}=await this.sb.from('cbt_results').select('*').eq('exam_id', cbtId).limit(5000);
    const norm=s=> String(s||'').trim().toLowerCase();
    const byAdm=new Map();
    const byName=new Map();
    const byNameNoSpace=new Map();
    (students||[]).forEach(s=>{
      const adm=norm(s.admission_no);
      if(adm) byAdm.set(adm, s);
      const name=norm(s.full_name);
      if(name) byName.set(name, s);
      const ns=name.replace(/\s+/g,'');
      if(ns) byNameNoSpace.set(ns, s);
    });
    const resultMap=new Map();
    (results||[]).forEach(r=>{
      let st=null;
      const refAdm=norm(r.student_id_ref);
      const refName=norm(r.student_name);
      const refNoSpace=refName.replace(/\s+/g,'');
      if(refAdm && byAdm.has(refAdm)) st=byAdm.get(refAdm);
      else if(refName && byName.has(refName)) st=byName.get(refName);
      else if(refNoSpace && byNameNoSpace.has(refNoSpace)) st=byNameNoSpace.get(refNoSpace);
      else {
        for(const [k,v] of byName.entries()){
          if(refName && (refName.includes(k) || k.includes(refName))){ st=v; break; }
        }
      }
      if(st) resultMap.set(String(st.id), r);
    });
    let {data:assign}=await this.sb.from('assignments').select('id,title').eq('cbt_exam_id', cbtId).maybeSingle();
    let assignId=assign && assign.id;
    if(!assignId){
      try{
        const {data:ins}=await this.sb.from('assignments').insert({title:exam.title, class:exam.class, subject:exam.subject, cbt_exam_id:exam.id, is_cbt:true, source:'cbt_assignment', posted_by:exam.teacher_id, drive_link: exam.code ? './cbt-exam.html?code='+exam.code : null}).select('id').maybeSingle();
        assignId=ins && ins.id;
      }catch(_){ assignId=null; }
    }
    const autoKind='CBT assignment (auto-marked)';
    const autoMax=Number(exam.max_score||10)||10;
    const rows=(students||[]).map(s=>{
      const res=resultMap.get(String(s.id));
      const score=res ? (res.score!=null ? res.score : '') : '';
      const max=autoMax;
      const cbtInfo=res ? `<span style="color:#166534;font-weight:700">CBT: ${res.score}/${res.total} (${res.percent||0}%)</span><br><small>Cert: ${res.cert_code||'—'}</small>` : '<span style="color:#94a3b8">No CBT result yet — student has not taken it</span>';
      return `<tr data-sid="${s.id}" data-ref="${this.esc(s.admission_no||'')}" data-name="${this.esc(s.full_name)}"><td><b>${this.esc(s.full_name)}</b><br><small>${this.esc(s.admission_no||'')} · ${this.esc(s.class||'')}</small></td><td>${cbtInfo}</td><td><input class="form-input ap-sc" type="number" min="0" max="${max}" style="width:90px" value="${score}" data-max="${max}" placeholder="—"></td></tr>`;
    }).join('');
    openModal(`🖥️ Score CBT Assignment: ${this.esc(exam.title)} (${this.esc(exam.code)}) — Auto-filled`,
      `<div class="notice" style="background:#f0fdf4;border-color:#86efac;color:#166534"><b>✅ Auto-filled from CBT results</b> — ${results?results.length:0} result(s) found, ${resultMap.size} matched to class register. Scores, kind and max are auto-filled. Physical assignments require manual entry; CBT assignments auto-fill seamlessly. They accumulate cumulatively for ${this.esc(exam.class)} · ${this.esc(exam.subject)} → push to Assignment column. Link auto-filled for students: <a href="./cbt-exam.html?code=${this.esc(exam.code)}" target="_blank">./cbt-exam.html?code=${this.esc(exam.code)}</a></div>
       <div class="grid grid-3" style="margin:8px 0">
         <div class="form-group"><label>Assignment kind (auto-filled)</label><select class="form-select" id="ap-cbt-kind" disabled><option selected>CBT assignment (auto-marked)</option><option>Written homework</option><option>Class exercise</option><option>Project</option><option>Practical</option></select><small style="color:#166534">Auto-filled — CBT assignments are auto-marked, no manual kind needed</small></div>
         <div class="form-group"><label>Maximum mark for THIS assignment (auto-filled)</label><input class="form-input" id="ap-cbt-max" type="number" value="${autoMax}" min="1" style="width:120px" readonly><small style="color:#166534">Auto-filled from CBT exam max_score (${autoMax})</small></div>
         <div class="form-group"><label>Purpose (auto-filled, differentiated)</label><input class="form-input" value="${this.esc(this.purposeLabel(exam))} — multiple per term, cumulative → Assignment column" readonly style="width:100%"><small style="color:#475569">Clearly differentiated from 🔵 Mid-term and 🔴 Terminal</small></div>
       </div>
       <div class="table-wrap" style="max-height:50vh;overflow:auto"><table><thead><tr><th>Student</th><th>CBT Result (auto)</th><th>Score to record (auto-filled)</th></tr></thead><tbody>${rows||'<tr><td colspan=3>No students in class '+this.esc(exam.class||'')+'</td></tr>'}</tbody></table></div>
       <p style="font-size:.82rem;color:#64748b">Blank = not submitted (excluded from totals). Auto-filled scores come from CBT engine — teacher can adjust before saving, then they accumulate. Reflects for every student of that class.</p>`,
      `<button class="btn btn-outline" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="AssignmentCBT.saveCBTScores('${cbtId}','${assignId||''}')">💾 Save ${students?students.length:0} auto-filled scores (cumulative)</button>`);
  },
  async saveCBTScores(cbtId, assignId){
    const max=Number((document.getElementById('ap-cbt-max')||{}).value)||10;
    const {data:exam}=await this.sb.from('cbt_exams').select('class,subject,term,session').eq('id', cbtId).maybeSingle();
    const rows=[...document.querySelectorAll('tr[data-sid]')].map(tr=>{
      const v=tr.querySelector('.ap-sc').value;
      if(v==='') return null;
      return {assignment_id:assignId||null, cbt_exam_id:cbtId, student_id:tr.getAttribute('data-sid'), student_id_ref:tr.getAttribute('data-ref'), student_name:tr.getAttribute('data-name'), class:(exam&&exam.class)||'', subject:(exam&&exam.subject)||'', term:(exam&&exam.term)||'', session:(exam&&exam.session)||'', score:Math.min(Number(v)||0,max), max_score:max, recorded_by:(window.SC_PROFILE&&SC_PROFILE.id)||null};
    }).filter(Boolean);
    if(!rows.length){ toast('Enter at least one score','warning'); return; }
    let saved=0;
    for(const row of rows){
      const {error}=await this.sb.from('assignment_scores').upsert(row, {onConflict:'cbt_exam_id,student_id'});
      if(!error) saved++;
    }
    closeModal();
    toast(`💾 Saved ${saved} CBT assignment score(s) — they now accumulate cumulatively for report card Assignment column and reflect for every student of that class.`, 'success', 8000);
    if(window.AP){
      if(AP.matrix) AP.matrix();
      if(AP.totals) AP.totals();
    }
    this.log(`Saved ${saved} scores for CBT assignment ${cbtId}`, 'success');
  },
  // Student view helper: inject Take CBT buttons into assignments table for CBT assignments
  async injectStudentLinks(){
    try{
      const table=document.getElementById('assignments-table');
      if(!table) return;
      const role=String((window.SC_PROFILE&&SC_PROFILE.role)||'').toLowerCase();
      if(!['student','parent'].includes(role)) return;
      // Fetch assignments that are CBT for this student's class
      const {data:assigns}=await this.sb.from('assignments').select('id,title,class,subject,drive_link,cbt_exam_id,is_cbt').eq('is_cbt', true).limit(100);
      if(!assigns||!assigns.length) return;
      // For each row in table, if its drive_link is CBT link, ensure button
      const rows=table.querySelectorAll('tbody tr[data-id]');
      for(const tr of rows){
        const id=tr.getAttribute('data-id');
        const a=(assigns||[]).find(x=>x.id===id);
        if(!a) continue;
        const lastTd=tr.querySelector('td:last-child');
        if(!lastTd) continue;
        if(lastTd.querySelector('.ap-take-cbt')) continue;
        if(a.drive_link){
          const btn=document.createElement('a');
          btn.className='btn btn-sm btn-primary ap-take-cbt';
          btn.href=a.drive_link;
          btn.target='_blank';
          btn.textContent='🖥️ Take CBT Assignment';
          btn.style.marginRight='4px';
          lastTd.insertBefore(btn, lastTd.firstChild);
        }
      }
    }catch(_){}
  }
};

AssignmentCBT.patchAP = function(){
  if(!window.AP) return;
  try{
    const clsSel=document.getElementById('ap-class');
    const subSel=document.getElementById('ap-subject');
    if(clsSel && !clsSel._cbtPatched){
      clsSel.addEventListener('change', ()=>{ setTimeout(()=>{ AssignmentCBT.renderCBTSection(); }, 300); });
      clsSel._cbtPatched=true;
    }
    if(subSel && !subSel._cbtPatched){
      subSel.addEventListener('change', ()=>{ setTimeout(()=>{ AssignmentCBT.renderCBTSection(); }, 300); });
      subSel._cbtPatched=true;
    }
  }catch(_){}

  const origPull=AP.pullCBT;
  AP.pullCBT=async function(){
    const cls=(document.getElementById('ap-class')||{}).value, sub=(document.getElementById('ap-subject')||{}).value;
    if(!cls||!sub){ toast('Pick a class AND subject first.','warning'); return; }
    try{ await AssignmentCBT.uiSyncAll(); }catch(e){ if(origPull) return await origPull.call(AP); throw e; }
  };

  const origScoreModal=AP.scoreModal;
  AP.scoreModal=async function(assignmentId){
    if(!window.sb){ toast('Database not configured','warning'); return; }
    // V12.9: handle virtual CBT assignments first (not yet in assignments table)
    if(String(assignmentId).startsWith('virtual-')){
      const realCbtId=String(assignmentId).replace('virtual-','');
      if(realCbtId) return await AssignmentCBT.uiScoreCBT(realCbtId);
    }
    try{
      const {data:ass}=await sb.from('assignments').select('id,title,class,subject,cbt_exam_id,is_cbt,source').eq('id', assignmentId).maybeSingle();
      if(ass && (ass.is_cbt || ass.cbt_exam_id)){
        const realCbtId=ass.cbt_exam_id;
        if(realCbtId) return await AssignmentCBT.uiScoreCBT(realCbtId);
      }
    }catch(_){}
    // Physical assignment — manual entry for kind/max/scores
    return await origScoreModal.call(AP, assignmentId);
  };

  const origMatrix=AP.matrix;
  AP.matrix=async function(){
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
    const aids=[...new Set(scores.map(x=>x.assignment_id).filter(Boolean))];
    const cbtIds=[...new Set(scores.map(x=>x.cbt_exam_id).filter(Boolean))];
    let titles={};
    if(aids.length){const ar=await sb.from('assignments').select('id,title,cbt_exam_id,is_cbt').in('id',aids);(ar.data||[]).forEach(a=>{titles[a.id]= (a.is_cbt? '🖥️ ':'📄 ') + (a.title||'Assignment');});}
    if(cbtIds.length){
      const cr=await sb.from('cbt_exams').select('id,code,title').in('id',cbtIds);
      (cr.data||[]).forEach(c=>{ titles[c.id]= '🖥️ '+ (c.title||c.code||'CBT Assignment'); (scores.filter(s=>s.cbt_exam_id===c.id && s.assignment_id)).forEach(s=>{ if(!titles[s.assignment_id]) titles[s.assignment_id]=titles[c.id]; }); });
    }
    const colKeysSet=new Set();
    scores.forEach(x=>{ if(x.cbt_exam_id) colKeysSet.add(x.cbt_exam_id); else if(x.assignment_id) colKeysSet.add(x.assignment_id); else colKeysSet.add('orphan'); });
    const colKeys=[...colKeysSet];
    const colLabel=k=>{ if(k==='orphan') return '📄 Assignment (legacy)'; return titles[k] || (k.startsWith('virtual-')? '🖥️ CBT Assignment' : '📄 Assignment'); };
    const studs=(await sb.from('students').select('id,full_name,admission_no').eq('class',cls).order('full_name')).data||[];
    const byStud={};
    scores.forEach(x=>{
      const sid=String(x.student_id);
      (byStud[sid]=byStud[sid]||{});
      const ck=x.cbt_exam_id || x.assignment_id || 'orphan';
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

  // Patch CRUD for student Take buttons
  try{
    const origRender=window.CRUD && window.CRUD.renderList;
    if(window.CRUD && !window.CRUD._cbtAssignPatched){
      const base=window.CRUD.renderList.bind(window.CRUD);
      window.CRUD.renderList=async function(moduleId, opts){
        const res=await base(moduleId, opts);
        if(moduleId==='assignments'){
          setTimeout(()=>{ AssignmentCBT.injectStudentLinks(); }, 800);
        }
        return res;
      };
      window.CRUD._cbtAssignPatched=true;
    }
  }catch(_){}
};

window.AssignmentCBT = AssignmentCBT;
document.addEventListener('DOMContentLoaded', ()=>{
  setTimeout(()=>{
    AssignmentCBT.init(typeof sb!=='undefined'?sb:null);
    if(window.AP) AssignmentCBT.patchAP();
    AssignmentCBT.renderCBTSection();
    AssignmentCBT.injectStudentLinks();
  }, 900);
});

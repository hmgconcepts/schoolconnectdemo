-- ============================================================================
-- SCHOOL CONNECT DEMO — COMPLETE SIMULATED SCHOOL DATASET
-- ----------------------------------------------------------------------------
-- Populates a demo deployment with a realistic, fully-interconnected school:
-- academic periods, subjects, 18 students, 8 staff, fee structures & payments,
-- attendance, check-ins, results + report-card columns/scores/comments/traits,
-- a published CBT exam with real questions + submissions, announcements,
-- events, a live poll, gallery, diary, conduct, health, assignments, survey,
-- leave, visitors, helpdesk, hostel, staff clock-ins, timetable requirements,
-- school shop products, ID cards and sample generic-module records.
--
-- RUN ORDER (see DEMO-SETUP.md):
--   1) database/complete-schema.sql   2) database/demo-users.sql   3) THIS FILE
-- Everything is guarded and idempotent — re-running only tops up what is
-- missing. Demo person accounts (from demo-users.sql):
--   a1 admin  a2 teacher(Funke Alabi)  a3 parent(Mr. Okafor)
--   a4 student(Adanna Okafor)  a5 bursar
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Resolve the five demo account ids BY EMAIL
--    Works however the accounts were created: demo-users.sql (fixed UUIDs),
--    Supabase Dashboard "Add user", or the Admin API (random UUIDs).
--    Missing accounts simply degrade those links to NULL — the seed always
--    completes; run demo-users.sql v6 (after Dashboard Add user × 5) to approve the profiles.
--    Account emails are @scdemo.school — created via Dashboard "Add user"
--    (v6 rationale: dashboard-created accounts log in perfectly on the
--    newest GoTrue; SQL-created auth rows cannot; login itself never
--    validates domains — only the public signup API does).
-- ----------------------------------------------------------------------------
-- Session-scoped (NOT `on commit drop`): the SQL Editor commits each statement
-- separately, and this table must survive every statement of the whole run.
create temporary table if not exists sc_demo_ids (role text primary key, id uuid);
insert into sc_demo_ids (role, id) values
  ('admin',   (select id from public.profiles where email='admin@scdemo.school'   limit 1)),
  ('teacher', (select id from public.profiles where email='teacher@scdemo.school' limit 1)),
  ('parent',  (select id from public.profiles where email='parent@scdemo.school'  limit 1)),
  ('student', (select id from public.profiles where email='student@scdemo.school' limit 1)),
  ('bursar',  (select id from public.profiles where email='bursar@scdemo.school'  limit 1))
on conflict (role) do update set id = excluded.id;

-- ----------------------------------------------------------------------------
-- 0) Constants used everywhere (current period = Third Term 2025/2026)
-- ----------------------------------------------------------------------------
-- session: '2025/2026'  term: 'Third Term'  next term begins: 2026-09-07

-- 1) Academic periods ---------------------------------------------------------
insert into public.academic_periods (session, term, starts_on, ends_on, is_current)
values
 ('2025/2026','First Term','2025-09-08','2025-12-12',false),
 ('2025/2026','Second Term','2026-01-12','2026-04-03',false),
 ('2025/2026','Third Term','2026-04-27','2026-07-24',true),
 ('2026/2027','First Term','2026-09-07','2026-12-11',false)
on conflict (session, term) do nothing;

-- 2) School settings polish (safe: updates the seeded singleton row) ----------
-- NOTE: names the simulated school. Prospects see this everywhere in the demo.
update public.school_settings set
  school_name = 'School Connect Demonstration College',
  short_name = 'SCD',
  admission_acronym = 'SCD',
  admission_prefix = 'SCD',
  staff_prefix = 'SCD-STF',
  principal_name = 'Mrs. Funke Alabi',
  next_term_begins = '2026-09-07',
  next_term_fees = 225000,
  next_term_fees_currency = '₦',
  next_term_fees_note = 'Boarding students add ₦60,000 boarding fee. PTA levy ₦5,000 per family.',
  checkin_deadline = coalesce(nullif(checkin_deadline,''),'07:45'),
  checkin_grace_minutes = greatest(coalesce(checkin_grace_minutes,0),15),
  stamp_enabled = true,
  stamp_text = coalesce(nullif(stamp_text,''),'OFFICIAL SCHOOL SEAL')
where id = 1;

-- 3) Subjects ------------------------------------------------------------------
do $$
declare s text[][] := array[
 ['Mathematics','MTH','Mathematics'],['English Language','ENG','Languages'],
 ['Physics','PHY','Sciences'],['Chemistry','CHM','Sciences'],['Biology','BIO','Sciences'],
 ['Economics','ECO','Commercial'],['Government','GOV','Arts'],['Literature in English','LIT','Arts'],
 ['Computer Science','CSC','Technology'],['Civic Education','CIV','General'],
 ['Further Mathematics','FMT','Mathematics'],['Yoruba Language','YOR','Languages']];
 x text[];
begin
  foreach x slice 1 in array s loop
    if not exists (select 1 from public.subjects where name = x[1]) then
      insert into public.subjects (name, code, department, level, teacher) values (x[1], x[2], x[3], 'All', null);
    end if;
  end loop;
end $$;

-- 4) Students (18) — classes: JSS 1A/B, JSS 2A, JSS 3A, SS 1A, SS 2A/B, arms AB
do $$
declare st text[][] := array[
 -- admission_no, full_name, class, arm, department, gender, dob, guardian, guardian_phone
 ['SCD-00001','Adaeze Nwosu','JSS 1','A','General','Female','2015-03-14','Mrs. Ngozi Nwosu','+234 803 111 0001'],
 ['SCD-00002','Tobi Adeyemi','JSS 1','A','General','Male','2015-06-02','Mr. Kunle Adeyemi','+234 803 111 0002'],
 ['SCD-00003','Chiamaka Eze','JSS 1','A','General','Female','2015-01-23','Mr. Adewale Okafor','+234 803 111 0003'],
 ['SCD-00004','Ibrahim Musa','JSS 1','B','General','Male','2014-11-30','Alhaji Musa Ibrahim','+234 803 111 0004'],
 ['SCD-00005','Somto Okonkwo','JSS 1','B','General','Female','2015-05-18','Mrs. Adaeze Okonkwo','+234 803 111 0005'],
 ['SCD-00006','Femi Ogunleye','JSS 2','A','General','Male','2014-04-09','Chief B. Ogunleye','+234 803 111 0006'],
 ['SCD-00007','Ngozi Umeh','JSS 2','A','General','Female','2014-08-27','Dr. Ify Umeh','+234 803 111 0007'],
 ['SCD-00008','Yusuf Bello','JSS 2','A','General','Male','2014-02-15','Mr. Garba Bello','+234 803 111 0008'],
 ['SCD-00009','Kelechi Obi','JSS 3','A','General','Male','2013-07-19','Mrs. Uche Obi','+234 803 111 0009'],
 ['SCD-00010','Zainab Lawal','JSS 3','A','General','Female','2013-10-05','Barr. H. Lawal','+234 803 111 0010'],
 ['SCD-00011','Chidera Nnamdi','SS 1','A','Science','Female','2012-12-11','Engr. P. Nnamdi','+234 803 111 0011'],
 ['SCD-00012','Emeka Eze','SS 1','A','Science','Male','2012-09-21','Mr. Tony Eze','+234 803 111 0012'],
 ['SCD-00013','Blessing Adebayo','SS 1','A','Science','Female','2013-01-08','Pastor S. Adebayo','+234 803 111 0013'],
 ['SCD-00014','Adanna Okafor','SS 2','A','Science','Female','2011-05-26','Mr. Adewale Okafor','+234 803 111 0014'],
 ['SCD-00015','Ikenna Okoro','SS 2','A','Science','Male','2011-08-13','Chief O. Okoro','+234 803 111 0015'],
 ['SCD-00016','Fatima Usman','SS 2','A','Science','Female','2011-03-30','Dr. Aisha Usman','+234 803 111 0016'],
 ['SCD-00017','Tunde Bakare','SS 2','B','Commercial','Male','2011-07-07','Alhaji R. Bakare','+234 803 111 0017'],
 ['SCD-00018','Amara Obi','SS 2','B','Commercial','Female','2011-12-01','Mrs. Ebere Obi','+234 803 111 0018']
];
 x text[]; n int := 0;
begin
  foreach x slice 1 in array st loop
    n := n + 1;
    if not exists (select 1 from public.students where admission_no = x[1]) then
      insert into public.students (id, admission_no, full_name, class, arm, department, gender, date_of_birth, guardian_name, guardian_phone, address, campus, status, user_id)
      values (('d4000000-0000-4000-8000-00000000'||lpad(to_hex(n),4,'0'))::uuid,
              x[1], x[2], x[3], x[4], x[5], x[6], x[7]::date, x[8], x[9], '12 Demo Crescent, Lagos', 'Main Campus', 'active',
              case when x[1]='SCD-00014' then (select id from sc_demo_ids where role='student') else null end);
    end if;
  end loop;
end $$;

-- 5) Staff (8) -----------------------------------------------------------------
do $$
declare sf text[][] := array[
 ['SCD-STF-00001','Funke Alabi','Mathematics Teacher','Mathematics','Mathematics, Further Mathematics','funke.alabi@scdemo.school'],
 ['SCD-STF-00002','Chukwuemeka Nwachukwu','English Teacher','Languages','English Language, Literature in English','c.nwachukwu@scdemo.school'],
 ['SCD-STF-00003','Hauwa Suleiman','Physics Teacher','Sciences','Physics, Basic Technology','h.suleiman@scdemo.school'],
 ['SCD-STF-00004','Olumide Ajayi','Biology Teacher','Sciences','Biology, Agricultural Science','o.ajayi@scdemo.school'],
 ['SCD-STF-00005','Ngozi Chukwu','Class Teacher (JSS 1)','General','Civic Education, Social Studies','n.chukwu@scdemo.school'],
 ['SCD-STF-00006','Ikechukwu Obasi','ICT / CBT Coordinator','Technology','Computer Science','i.obasi@scdemo.school'],
 ['SCD-STF-00007','Mariam Danladi','Bursar','Finance','', 'm.danladi@scdemo.school'],
 ['SCD-STF-00008','Sunday Etim','Admin Officer','Administration','','s.etim@scdemo.school']];
 x text[]; n int := 0;
begin
  foreach x slice 1 in array sf loop
    n := n + 1;
    if not exists (select 1 from public.staff where staff_no = x[1]) then
      insert into public.staff (id, staff_no, full_name, email, phone, role, department, subjects, part_time, status, user_id)
      values (('d5000000-0000-4000-8000-00000000'||lpad(to_hex(n),4,'0'))::uuid,
              x[1], x[2], x[3], '+234 805 222 00'||lpad(n::text,2,'0'), x[4], x[5],
              case when x[6] = '' then null else string_to_array(x[6], ', ')::text[] end, false, 'active',
              case when x[1]='SCD-STF-00001' then (select id from sc_demo_ids where role='teacher') else null end);
    end if;
  end loop;
end $$;

-- 6) Parent-child links: demo parent (a3) → Adanna (SS 2A) & Chiamaka (JSS 1A)
do $$
begin
    insert into public.parent_child (parent_id, student_id, relationship, verified)
    select p.id, s.id, 'parent', true
    from sc_demo_ids p, public.students s
    where p.role='parent' and p.id is not null and s.admission_no in ('SCD-00014','SCD-00003')
    on conflict do nothing;
end $$;

-- 7) Class fee structures (Third Term 2025/2026) --------------------------------
do $$
declare fs text[][] := array[
 -- class, arm, dept, tuition, exam, development, other, total
 ['JSS 1','A','General','185000','15000','10000','5000','215000'],
 ['JSS 1','B','General','185000','15000','10000','5000','215000'],
 ['JSS 2','A','General','190000','15000','10000','5000','220000'],
 ['JSS 3','A','General','195000','18000','10000','5000','228000'],
 ['SS 1','A','Science','215000','20000','12000','8000','255000'],
 ['SS 2','A','Science','225000','22000','12000','8000','267000'],
 ['SS 2','B','Commercial','215000','22000','12000','8000','257000']];
 x text[];
begin
  foreach x slice 1 in array fs loop
    insert into public.class_fee_structure (class, arm, department, term, session, tuition, exam_fee, development, other_fee, total, amount, currency, next_term_begins, note, fee_items, active)
    values (x[1], x[2], x[3], 'Third Term', '2025/2026', x[4]::numeric, x[5]::numeric, x[6]::numeric, x[7]::numeric, x[8]::numeric, x[8]::numeric, '₦', '2026-09-07',
            'Boarding students add ₦60,000. Sibling discount 5% on tuition from 3rd child.',
            jsonb_build_array(
              jsonb_build_object('item','Tuition','amount',x[4]::numeric),
              jsonb_build_object('item','Examination','amount',x[5]::numeric),
              jsonb_build_object('item','Development levy','amount',x[6]::numeric),
              jsonb_build_object('item','ICT & e-learning','amount',x[7]::numeric)), true)
    on conflict (class, arm, department, term) do nothing;
  end loop;
end $$;

-- 8) Fee payments — mix of fully paid, half paid and a few outstanding --------
do $$
declare
  s record; idx int := 0; bill numeric; pay numeric; meth text;
begin
  for s in select st.id, st.admission_no, st.class, st.arm, coalesce(st.department,'General') dept,
                  coalesce(cfs.total,210000) total
           from public.students st
           left join public.class_fee_structure cfs
             on cfs.class=st.class and cfs.arm=st.arm and cfs.department=coalesce(st.department,'General') and cfs.term='Third Term'
           order by st.admission_no loop
    idx := idx + 1;
    pay := case when idx % 3 = 0 then s.total            -- every 3rd: full
                when idx % 3 = 1 then round(s.total/2)   -- half
                else 0 end;                              -- every 3rd from 0: owing
    if pay > 0 and not exists (select 1 from public.fee_payments where student_id=s.id and term='Third Term' and session='2025/2026') then
      insert into public.fee_payments (student_id, amount_paid, fee_total, method, reference, term, session, received_by)
      values (s.id, pay, s.total, case when idx%2=0 then 'Bank Transfer' else 'POS' end,
              'DEMO-PAY-2026-'||lpad(idx::text,3,'0'), 'Third Term', '2025/2026',
              (select id from sc_demo_ids where role='bursar'));
    end if;
  end loop;
end $$;

-- 9) Attendance — last 12 school days, deterministic realistic pattern --------
do $$
declare
  s record; d date; idx int; dow int; stat text;
begin
  for s in select id, admission_no, class, arm from public.students order by admission_no loop
    for d in select gs::date from generate_series(current_date - 18, current_date - 1, interval '1 day') gs loop
      dow := extract(isodow from d);
      if dow > 5 then continue; end if;                     -- school days only
      idx := (substring(s.admission_no from 5))::int;
      stat := case
                when (idx + extract(day from d)::int) % 17 = 0 then 'absent'
                when (idx + extract(day from d)::int) % 9  = 0 then 'late'
                when (idx + extract(day from d)::int) % 23 = 0 then 'excused'
                else 'present' end;
      insert into public.attendance (student_id, class, date, status, time_in)
      values (s.id, s.class||' '||s.arm, d, stat,
              case when stat in ('present','late') then (d + time '07:3'|| (idx%9)::text)::timestamptz end)
      on conflict (student_id, date) do nothing;
      if stat in ('present','late') and not exists (select 1 from public.student_clock where student_id=s.id and date=d) then
        insert into public.student_clock (student_id, clock_in, date)
        values (s.id, (d + time '07:2' || (idx%10)::text)::timestamptz, d);
      end if;
    end loop;
  end loop;
end $$;

-- 10) Results — SS 2 A Science, 5 subjects (feeds Results + Broadsheets) -------
do $$
declare
  subs text[] := array['Mathematics','English Language','Physics','Chemistry','Biology'];
  s record; sub text; idx int; c1 int; c2 int; ex int; tot int; gr text;
begin
  for s in select id, admission_no from public.students where admission_no in ('SCD-00014','SCD-00015','SCD-00016') order by admission_no loop
    idx := 0;
    foreach sub in array subs loop
      idx := idx + 1;
      if exists (select 1 from public.results where student_id=s.id and subject=sub and class='SS 2' and term='Third Term' and session='2025/2026') then continue; end if;
      c1 := 8 + ((substring(s.admission_no from 5))::int + idx*3) % 12;       -- 8..19
      c2 := 9 + ((substring(s.admission_no from 5))::int + idx*5) % 11;       -- 9..19
      ex := 38 + ((substring(s.admission_no from 5))::int + idx*7) % 21;      -- 38..58
      tot := c1 + c2 + ex;
      gr := case when tot>=70 then 'A' when tot>=60 then 'B' when tot>=50 then 'C' when tot>=45 then 'D' when tot>=40 then 'E' else 'F' end;
      insert into public.results (student_id, subject, class, term, session, ca1, ca2, exam, grade, remark)
      values (s.id, sub, 'SS 2', 'Third Term', '2025/2026', c1, c2, ex, gr,
              case when tot>=60 then 'Excellent' when tot>=50 then 'Very good' when tot>=40 then 'Fair' else 'Needs improvement' end);
    end loop;
  end loop;
end $$;

-- 11) Report card: assessment columns (fixed ids d6100000-…-01..15) -----------
do $$
declare
  subs text[] := array['Mathematics','English Language','Physics','Chemistry','Biology'];
  cols text[][] := array[['CA 1','20','1'],['CA 2','20','2'],['Exam','60','3']];
  sub text; c text[]; n int := 0;
begin
  foreach sub in array subs loop
    foreach c slice 1 in array cols loop
      n := n + 1;
      insert into public.assessment_columns (id, class, subject, term, session, name, max_mark, weight, position, source)
      values (('d6100000-0000-4000-8000-00000000'||lpad(to_hex(n),4,'0'))::uuid, 'SS 2', sub, 'Third Term', '2025/2026', c[1], c[2]::int, 1, c[3]::int, 'teacher')
      on conflict do nothing;
    end loop;
  end loop;
end $$;

-- 12) Report card scores (upsert key: column+student_ref+name+class+subject+term+session)
do $$
declare
  s record; col record; base numeric;
begin
  for s in select id, admission_no, full_name from public.students where admission_no in ('SCD-00014','SCD-00015','SCD-00016') order by admission_no loop
    for col in select id, name, subject, max_mark from public.assessment_columns where class='SS 2' and term='Third Term' and session='2025/2026' loop
      base := round((col.max_mark * 0.62) + ((substring(s.admission_no from 5))::int % 7));
      insert into public.report_scores (column_id, student_id, student_id_ref, student_name, class, subject, term, session, score, source)
      values (col.id, s.id, s.admission_no, s.full_name, 'SS 2', col.subject, 'Third Term', '2025/2026', least(base, col.max_mark), 'teacher')
      on conflict (column_id, student_id_ref, student_name, class, subject, term, session) do nothing;
    end loop;
  end loop;
end $$;

-- 13) Report comments + affective & psychomotor traits -------------------------
do $$
declare
  s record;
begin
  for s in select id from public.students where admission_no in ('SCD-00014','SCD-00015','SCD-00016') loop
    insert into public.report_comments (student_id, term, session, class_teacher_comment, principal_comment, next_term_begins)
    values (s.id, 'Third Term', '2025/2026',
            'A focused and consistent term. Keep up the excellent study culture.',
            'A solid term of hard work — the school is proud of this performance.',
            '2026-09-07')
    on conflict (student_id, term, session) do nothing;
    insert into public.affective_traits (student_id, term, session, ratings)
    values (s.id, 'Third Term', '2025/2026',
            jsonb_build_object('Punctuality',5,'Neatness',4,'Honesty',5,'Relationship with others',4,'Attentiveness',5))
    on conflict (student_id, term, session) do nothing;
    insert into public.psychomotor_traits (student_id, term, session, ratings)
    values (s.id, 'Third Term', '2025/2026',
            jsonb_build_object('Handwriting',4,'Sports & games',5,'Drawing & painting',3,'Crafts',4,'Musical skills',3))
    on conflict (student_id, term, session) do nothing;
  end loop;
end $$;

-- 14) CBT exams (fixed ids) with REAL embedded questions -------------------------
do $$
begin
  if not exists (select 1 from public.cbt_exams where code='DEMO-MATH1') then
    insert into public.cbt_exams (id, teacher_id, code, title, subject, class, term, session, topic, assessment_type, max_score, duration_min, attempt_limit, randomise, is_open, is_archived, pass_mark, release_results, instructions, certificate_enabled, questions)
    values ('d6000000-0000-4000-8000-000000000001', coalesce((select id from sc_demo_ids where role='teacher'), (select id from public.profiles where role in ('admin','teacher') order by role limit 1)),
      'DEMO-MATH1','JSS 1 Mathematics Speed Test','Mathematics','JSS 1','Third Term','2025/2026','Number & Algebra','CA',
      100, 10, 1, true, true, false, 50, true,
      'Answer all questions. Each question carries 10 marks. No calculator.', true,
      '[
        {"question":"What is the value of 2x + 3 when x = 4?","options":["5","11","13","23"],"answer":"B","explanation":"2(4)+3 = 8+3 = 11.","mark":10},
        {"question":"Simplify: 3/5 + 1/5","options":["4/10","4/5","2/5","1"],"answer":"B","explanation":"Same denominators: (3+1)/5 = 4/5.","mark":10},
        {"question":"What is the LCM of 4 and 6?","options":["10","24","12","8"],"answer":"C","explanation":"Multiples of 4: 4,8,12…; of 6: 6,12… ⇒ 12.","mark":10},
        {"question":"A triangle has angles 50° and 60°. The third angle is?","options":["70°","80°","60°","90°"],"answer":"A","explanation":"Angles in a triangle sum to 180°.","mark":10},
        {"question":"Write 0.75 as a fraction in lowest terms.","options":["3/4","7/5","75/10","1/4"],"answer":"A","explanation":"0.75 = 75/100 = 3/4.","mark":10},
        {"question":"What is 15% of 200?","options":["20","30","25","35"],"answer":"B","explanation":"0.15 × 200 = 30.","mark":10},
        {"question":"Solve: 5y = 45","options":["y = 8","y = 9","y = 7","y = 40"],"answer":"B","explanation":"y = 45 ÷ 5 = 9.","mark":10},
        {"question":"The perimeter of a square of side 7 cm is?","options":["14 cm","21 cm","28 cm","49 cm"],"answer":"C","explanation":"P = 4 × 7 = 28 cm.","mark":10},
        {"question":"Which of these is a prime number?","options":["9","15","17","21"],"answer":"C","explanation":"17 has exactly two factors: 1 and 17.","mark":10},
        {"question":"Round 4.467 to 1 decimal place.","options":["4.4","4.5","4.47","5.0"],"answer":"B","explanation":"The second decimal (6) rounds the first up.","mark":10}
      ]'::jsonb);
  end if;
  if not exists (select 1 from public.cbt_exams where code='DEMO-ENG2') then
    insert into public.cbt_exams (id, teacher_id, code, title, subject, class, term, session, topic, assessment_type, max_score, duration_min, attempt_limit, randomise, is_open, is_archived, pass_mark, release_results, instructions, certificate_enabled, questions)
    values ('d6000000-0000-4000-8000-000000000002', coalesce((select id from sc_demo_ids where role='teacher'), (select id from public.profiles where role in ('admin','teacher') order by role limit 1)),
      'DEMO-ENG2','SS 2 English Lexis & Structure','English Language','SS 2','Third Term','2025/2026','Lexis and Structure','Exam',
      100, 8, 2, false, true, false, 60, true,
      'Choose the option that best completes each sentence.', false,
      '[
        {"question":"Neither the teacher nor the students ___ present.","options":["was","were","is","has been"],"answer":"B","explanation":"Proximity rule: the nearer subject (students) is plural.","mark":20},
        {"question":"The synonym of FRUGAL is","options":["wasteful","thrifty","generous","careless"],"answer":"B","explanation":"Frugal = economical/thrifty.","mark":20},
        {"question":"Choose the correctly spelt word.","options":["Occurence","Ocurrence","Occurrence","Ocurrance"],"answer":"C","explanation":"Double c, double r: occurrence.","mark":20},
        {"question":"The principal addressed the assembly, ___?","options":["did he","didn''t he","doesn''t he","wasn''t he"],"answer":"B","explanation":"Positive statement → negative tag; past tense → didn''t.","mark":20},
        {"question":"''To let the cat out of the bag'' means","options":["to free a pet","to reveal a secret","to cause trouble","to buy a pet"],"answer":"B","explanation":"Idiom: reveal a secret.","mark":20}
      ]'::jsonb);
  end if;
end $$;

-- 15) CBT submissions (realistic student attempts) ------------------------------
do $$
declare
  exam1 uuid := 'd6000000-0000-4000-8000-000000000001';
  exam2 uuid := 'd6000000-0000-4000-8000-000000000002';
  s record; idx int := 0; sc int; att int;
begin
  for s in select id, admission_no, full_name, class, arm from public.students order by admission_no loop
    idx := idx + 1;
    if s.class='JSS 1' and exists (select 1 from public.cbt_exams where id=exam1)
       and not exists (select 1 from public.cbt_results where exam_id=exam1 and student_id_ref=s.admission_no) then
      sc := 30 + (idx*13) % 71;  -- 30..100
      insert into public.cbt_results (exam_id, student_id, student_name, student_class, student_id_ref, student_type, score, total, percent, correct_count, wrong_count, attempt_number, time_taken, submitted_at)
      values (exam1, s.id, s.full_name, s.class||' '||s.arm, s.admission_no, 'student', sc, 100, sc, sc/10, 10 - sc/10, 1, 300 + (idx*37)%240, now() - ((idx%5)::text||' days')::interval);
    end if;
    if s.class='SS 2' and s.arm='A' and exists (select 1 from public.cbt_exams where id=exam2)
       and not exists (select 1 from public.cbt_results where exam_id=exam2 and student_id_ref=s.admission_no) then
      att := 1 + (idx % 2);
      sc := 40 + (idx*17) % 61;
      insert into public.cbt_results (exam_id, student_id, student_name, student_class, student_id_ref, student_type, score, total, percent, correct_count, wrong_count, attempt_number, time_taken, submitted_at)
      values (exam2, s.id, s.full_name, s.class||' '||s.arm, s.admission_no, 'student', sc, 100, sc, sc/20, 5 - sc/20, att, 240 + (idx*29)%180, now() - ((idx%4)::text||' days')::interval);
    end if;
  end loop;
end $$;

-- 16) Announcements --------------------------------------------------------------
do $$
declare a text[][] := array[
 ['Welcome to Third Term!','We warmly welcome all students and parents to Third Term 2025/2026. Check the portal for the updated fee bills and the academic calendar.','high','true'],
 ['PTA Meeting — Saturday 25 July','All parents are invited to the termly PTA meeting in the school hall at 10:00 AM. Agenda: results review, next-term fees, security update.','normal','false'],
 ['Mid-Term Break Notice','School closes for the mid-term break on Thursday and Friday. Boarding students return on Sunday by 5 PM.','urgent','false']];
 x text[];
begin
  foreach x slice 1 in array a loop
    if not exists (select 1 from public.announcements where title = x[1]) then
      insert into public.announcements (title, body, priority, pinned, audience, posted_by)
      values (x[1], x[2], x[3], x[4]::boolean, 'all', null);
    end if;
  end loop;
end $$;

-- 17) Events & school calendar ---------------------------------------------------
do $$
begin
  if not exists (select 1 from public.events where title='Inter-House Sports') then
    insert into public.events (title, description, date, venue, organiser) values
      ('Inter-House Sports','Annual inter-house athletics competition. Parents are welcome.','2026-07-31','School Sports Complex','Games Department'),
      ('Open Day','Prospective parents tour the school and meet teachers.','2026-08-14','Main Campus','Admissions Office'),
      ('Cultural Day','Students showcase Nigeria''s rich cultures — dress code: traditional wear.','2026-08-28','School Hall','Social Committee');
  end if;
  if not exists (select 1 from public.module_records where module='school_calendar' and title='Third Term Ends') then
    insert into public.module_records (module, title, ref_date, body, data) values
      ('school_calendar','Third Term Ends','2026-07-24','Students vacate for the session break.','{"category":"term-end"}'::jsonb),
      ('school_calendar','First Term 2026/2027 Begins','2026-09-07','Resumption — all students and staff.','{"category":"term-start"}'::jsonb);
  end if;
end $$;

-- 18) Live poll + votes ------------------------------------------------------------
do $$
declare pid uuid;
begin
  if not exists (select 1 from public.polls where title='Vote: Best Teacher of the Term') then
    insert into public.polls (title, type, candidates, allow_multiple, anonymous, audience, status, created_by)
    values ('Vote: Best Teacher of the Term','single_choice',
            '[{"id":"c1","name":"Mrs. Funke Alabi (Mathematics)"},{"id":"c2","name":"Mr. C. Nwachukwu (English)"},{"id":"c3","name":"Mrs. Hauwa Suleiman (Physics)"}]'::jsonb,
            false, true, 'all', 'open', null)
    returning id into pid;
    insert into public.poll_votes (poll_id, candidate_id, voter_id)
    select pid, case d.role when 'parent' then 'c3' else 'c1' end, d.id
    from sc_demo_ids d
    where d.role in ('teacher','student','parent','bursar') and d.id is not null
    on conflict do nothing;
  end if;
end $$;

-- 19) Gallery ----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.gallery where album='School Life 2026') then
    insert into public.gallery (album, caption, media_url, media_type, uploaded_by) values
      ('School Life 2026','Interactive whiteboard session in the ICT lab','assets/img/og-cover.svg','image',null),
      ('School Life 2026','Inter-house sports — final lap of the 100m race','assets/img/logo.png','image',null),
      ('School Life 2026','Science practical: titration experiment in the chemistry lab','assets/img/og-cover.svg','image',null);
  end if;
end $$;

-- 20) Diary, conduct, health, assignments, lesson plans ---------------------------
do $$
declare
  adanna uuid := (select id from public.students where admission_no='SCD-00014' limit 1);
  chiamaka uuid := (select id from public.students where admission_no='SCD-00003' limit 1);
begin
  if adanna is not null and (select count(*) from public.student_diary) < 3 then
    insert into public.student_diary (student_id, student_name, class, subject, date, entry_type, title, body, created_by) values
      (adanna,'Adanna Okafor','SS 2 A','English Language',current_date - 1,'homework','Essay assignment reminder','Adanna is to submit her argumentative essay on Friday. Please ensure she revises the outline shared in class.',coalesce((select id from sc_demo_ids where role='teacher'), (select id from public.profiles where role in ('admin','teacher') order by role limit 1))),
      (chiamaka,'Chiamaka Eze','JSS 1 A','Mathematics',current_date - 2,'commendation','Excellent mental maths today','Chiamaka answered five mental-maths questions correctly in class today. Well done!',coalesce((select id from sc_demo_ids where role='teacher'), (select id from public.profiles where role in ('admin','teacher') order by role limit 1))),
      (adanna,'Adanna Okafor','SS 2 A','Class Teacher',current_date - 5,'general','Reading culture','Encourage Adanna to complete the class novel before the literature quiz next week.',coalesce((select id from sc_demo_ids where role='teacher'), (select id from public.profiles where role in ('admin','teacher') order by role limit 1)));
  end if;
  if (select count(*) from public.conduct) < 3 then
    insert into public.conduct (student_id, type, description, reporter, date) values
      ((select id from public.students where admission_no='SCD-00014'),'merit','Won the inter-class science quiz for SS 2 A.','Mrs. Funke Alabi',current_date - 3),
      ((select id from public.students where admission_no='SCD-00015'),'demerit','Late to morning assembly twice this week.','Mr. Sunday Etim',current_date - 2),
      ((select id from public.students where admission_no='SCD-00016'),'merit','Volunteered as lab assistant for the JSS practicals.','Mrs. Hauwa Suleiman',current_date - 1);
  end if;
  if (select count(*) from public.health) < 2 then
    insert into public.health (student_id, complaint, treatment, date, recorded_by) values
      ((select id from public.students where admission_no='SCD-00003'),'Mild headache after break','Rested in sickbay; paracetamol given after phoning guardian. Recovered and returned to class.',current_date - 4,'Sickbay Nurse'),
      ((select id from public.students where admission_no='SCD-00002'),'Graze on the knee during games','Cleaned and dressed. No further attention required.',current_date - 6,'Sickbay Nurse');
  end if;
  if (select count(*) from public.assignments) < 3 then
    insert into public.assignments (title, description, class, subject, due_date, posted_by) values
      ('Argumentative Essay: Social Media','Write a 400-word argumentative essay on "Social media does more good than harm".','SS 2','English Language','2026-08-01', null),
      ('Algebra Worksheet 3','Complete questions 1–15 on linear equations (textbook page 42).','JSS 1','Mathematics','2026-07-28', null),
      ('Cell Structure Diagram','Draw and label a plant cell; list three differences between plant and animal cells.','SS 1','Biology','2026-07-30', null);
  end if;
  if (select count(*) from public.lesson_plans) < 3 then
    insert into public.lesson_plans (teacher, subject, class, week, term, session, objectives, content, resources, status) values
      ('Funke Alabi','Mathematics','SS 2',10,'Third Term','2025/2026','Students will solve simultaneous equations by elimination and substitution.','Introduction (5 min) → worked examples (20 min) → guided practice (15 min) → exit quiz (5 min).','Whiteboard, worksheet pack, graph board','approved'),
      ('Chukwuemeka Nwachukwu','English Language','SS 2',10,'Third Term','2025/2026','Master summary writing: topic sentences and concision.','Passage analysis, group summary, peer review.','New Oxford Secondary English Course','submitted'),
      ('Olumide Ajayi','Biology','SS 1',10,'Third Term','2025/2026','Identify cell organelles and state their functions.','Microscope practical + labelled diagram exercise.','Microscopes, prepared slides','approved');
  end if;
end $$;

-- 21) Survey, leave, visitors, helpdesk, hostel, staff clock ----------------------
do $$
begin
  if not exists (select 1 from public.surveys where title='End-of-Term Parent Satisfaction Survey') then
    insert into public.surveys (title, description, audience, questions, anonymous, is_open, created_by)
    values ('End-of-Term Parent Satisfaction Survey','Two-minute survey — help us serve your children better.','parent',
            '[{"q":"How satisfied are you with communication this term?","type":"rating"},{"q":"Rate the quality of teaching.","type":"rating"},{"q":"Any suggestions?","type":"text"}]'::jsonb, true, true, null);
  end if;
  if (select count(*) from public.leave_requests) = 0 then
    insert into public.leave_requests (staff_id, type, start_date, end_date, days, reason, status)
    values ((select id from public.staff where staff_no='SCD-STF-00002'),'casual','2026-08-05','2026-08-07',3,'Family engagement in Ibadan.','pending');
  end if;
  if (select count(*) from public.visitors) = 0 then
    insert into public.visitors (full_name, phone, purpose, host, check_in, check_out, badge_no) values
      ('Mrs. Titilayo Bello','+234 806 555 0101','Parent — collect report card','Front Desk',now() - interval '3 hours',now() - interval '2 hours','V-0041'),
      ('Engr. S. Okon','+234 806 555 0102','Prospective parent — school tour','Admissions Office',now() - interval '26 hours',now() - interval '25 hours','V-0042'),
      ('WAEC Supervisor','+234 806 555 0103','Official inspection','Principal''s Office',now() - interval '1 day',null,'V-0043');
  end if;
  if (select count(*) from public.helpdesk_tickets) = 0 then
    insert into public.helpdesk_tickets (submitted_by, category, subject, body, priority, status)
    values (coalesce((select id from sc_demo_ids where role='teacher'), (select id from public.profiles where role in ('admin','teacher') order by role limit 1)),'Facilities','Projector in SS 2 A not displaying','The classroom projector powers on but shows no image. Tried HDMI and VGA cables. Needed for Friday revision class.','normal','open');
  end if;
  if (select count(*) from public.hostel_allocations) = 0 then
    insert into public.hostel_allocations (student_id, block, room, bed, status) values
      ((select id from public.students where admission_no='SCD-00004'),'Block A','Room 12','Bed 3','active'),
      ((select id from public.students where admission_no='SCD-00016'),'Block C','Room 04','Bed 1','active');
  end if;
  if (select count(*) from public.staff_clock) = 0 then
    insert into public.staff_clock (staff_id, staff_no, staff_name, status, clock_in, clock_out, date)
    select st.id, st.staff_no, st.full_name,
           case when extract(isodow from d.gs::date) in (1,4) then 'on_time' else 'on_time' end,
           (d.gs::date + time '07:1' || (extract(isodow from d.gs::date))::text)::timestamptz,
           (d.gs::date + time '15:45')::timestamptz, d.gs::date
    from public.staff st cross join (select gs from generate_series(current_date - 6, current_date - 1, interval '1 day') gs) d
    where st.staff_no in ('SCD-STF-00001','SCD-STF-00002') and extract(isodow from d.gs::date) <= 5;
  end if;
end $$;

-- 22) Timetable requirements + school shop products + ID cards -------------------
do $$
begin
  insert into public.timetable_requirements (class, subject, teacher, periods_per_week, available_days, is_part_time) values
    ('SS 2','Mathematics','Funke Alabi',5,array['Mon','Tue','Wed','Thu','Fri']::text[],false),
    ('SS 2','English Language','Chukwuemeka Nwachukwu',4,array['Mon','Tue','Wed','Thu','Fri']::text[],false),
    ('SS 2','Physics','Hauwa Suleiman',4,array['Mon','Tue','Thu']::text[],false),
    ('SS 2','Chemistry','Hauwa Suleiman',3,array['Tue','Wed','Fri']::text[],false),
    ('SS 2','Biology','Olumide Ajayi',4,array['Mon','Wed','Fri']::text[],false),
    ('JSS 1','Mathematics','Funke Alabi',5,array['Mon','Tue','Wed','Thu','Fri']::text[],false)
  on conflict (class, subject) do nothing;
  if (select count(*) from public.school_products) = 0 then
    insert into public.school_products (name, description, price, active) values
      ('Exercise Book (80 leaves)','Custom-branded school exercise book','500', true),
      ('School Crested Badge','Iron-on crest for school uniform','1500', true);
  end if;
  if (select count(*) from public.idcards) = 0 then
    insert into public.idcards (person_id, person_type, card_no, qr_data) values
      ((select id from public.students where admission_no='SCD-00014'),'student','SCD-CARD-0001','{"adm":"SCD-00014","name":"Adanna Okafor"}'),
      ((select id from public.staff where staff_no='SCD-STF-00001'),'staff','SCD-CARD-1001','{"stf":"SCD-STF-00001","name":"Funke Alabi"}');
  end if;
end $$;

-- 23) Sample generic-module records (broadcast, cafeteria menu, lost & found, fleet)
do $$
begin
  if not exists (select 1 from public.module_records where module='broadcast') then
    insert into public.module_records (module, title, body, data) values
      ('broadcast','Third Term Results Published','Dear parents, third-term results are now live on the portal. Log in to view report cards and download them as PDF.','{"channel":"whatsapp","audience":"parent"}'::jsonb),
      ('cafeteria','Jollof rice & chicken','Served with steamed vegetables','{"category":"lunch"}'::jsonb),
      ('cafeteria','Fried yam & egg sauce','With fresh fruit juice','{"category":"breakfast"}'::jsonb),
      ('lost_found','HP calculator found in SS 2 A','Found after the mock exam. Collect from the front desk with identification.','{"kind":"found","location":"SS 2 A classroom"}'::jsonb),
      ('fleet_tracking','Route A — Agbado ↔ School','Bus departs 6:30 AM; returns 3:45 PM daily. Driver: Mr. Bassey (+234 806 555 0200).','{"driver":"Mr. Bassey"}'::jsonb);
  end if;
end $$;

select 'School Connect DEMO data installed ✅ — students, staff, parents, fees, attendance, results, report cards, CBT, polls and more.' as status;

-- 24) TASK 4: ENHANCED — populate ALL remaining pages with sample data ------
do $$
begin
  -- E-Resources / Notes
  if not exists (select 1 from public.module_records where module='eresources') then
    insert into public.module_records (module, title, body, data) values
      ('eresources','Mathematics — Simultaneous Equations Notes','Step-by-step guide to solving simultaneous equations by elimination and substitution methods.','{"subject":"Mathematics","class":"SS 2","uploaded_by":"Funke Alabi","file_type":"pdf"}'::jsonb),
      ('eresources','English — Essay Writing Guide','Complete guide to writing argumentative, expository and narrative essays.','{"subject":"English Language","class":"SS 2","uploaded_by":"Chukwuemeka Nwachukwu","file_type":"pdf"}'::jsonb),
      ('eresources','Biology — Cell Structure Revision Notes','Labelled diagrams of plant and animal cells with functions.','{"subject":"Biology","class":"SS 1","uploaded_by":"Olumide Ajayi","file_type":"pdf"}'::jsonb),
      ('eresources','Physics — Newton Laws of Motion','Comprehensive notes with real-life examples and calculation practice.','{"subject":"Physics","class":"SS 2","uploaded_by":"Hauwa Suleiman","file_type":"pdf"}'::jsonb),
      ('eresources','Chemistry — Periodic Table Trends','Study guide covering periodic table groups, periods, and trends.','{"subject":"Chemistry","class":"SS 2","uploaded_by":"Hauwa Suleiman","file_type":"pdf"}'::jsonb);
  end if;

  -- Complaints / Grievances
  if (select count(*) from public.complaints) = 0 then
    insert into public.complaints (submitted_by, type, subject, body, status, urgency) values
      (coalesce((select id from sc_demo_ids where role='parent'),'00000000-0000-0000-0000-000000000000'::uuid),'Academic','Concern about Mathematics performance','My child has been struggling with Mathematics this term. Could we arrange extra coaching?','in_progress','normal'),
      (coalesce((select id from sc_demo_ids where role='parent'),'00000000-0000-0000-0000-000000000000'::uuid),'Facilities','Broken desk in JSS 1 classroom','The desk in row 3 has a broken leg and is unsafe.','submitted','low'),
      (coalesce((select id from sc_demo_ids where role='student'),'00000000-0000-0000-0000-000000000000'::uuid),'General','Request for additional library books','We would appreciate more WAEC preparation materials.','resolved','normal');
  end if;

  -- Alumni
  if (select count(*) from public.alumni) = 0 then
    insert into public.alumni (full_name, graduation_year, last_class, occupation, email, phone) values
      ('Adebayo Johnson',2020,'SS 3','Software Engineer at Google','adebayo.j@email.com','+234 801 234 5678'),
      ('Chioma Eze',2019,'SS 3','Medical Doctor — LUTH','chioma.e@email.com','+234 802 345 6789'),
      ('Ibrahim Musa',2021,'SS 3','Law Student — University of Lagos','ibrahim.m@email.com','+234 803 456 7890'),
      ('Funmilayo Adeyemi',2018,'SS 3','Chartered Accountant — PwC','funmilayo.a@email.com','+234 804 567 8901');
  end if;

  -- Inventory / Assets
  if (select count(*) from public.inventory) = 0 then
    insert into public.inventory (item_name, category, quantity, condition, location, last_audit) values
      ('Desktop Computer','ICT Equipment',25,'Good','Computer Lab 1',current_date - 30),
      ('Projector','Teaching Aid',6,'Good','Various classrooms',current_date - 15),
      ('Microscope','Science Equipment',10,'Good','Biology Lab',current_date - 20),
      ('Fire Extinguisher','Safety Equipment',12,'Good','All floors',current_date - 10),
      ('School Bus (Toyota Hiace)','Vehicle',2,'Good','School premises',current_date - 7);
  end if;

  -- Staff Appraisals
  if (select count(*) from public.staff_appraisals) = 0 then
    insert into public.staff_appraisals (staff_id, appraiser, period, punctuality, teaching_quality, student_results, teamwork, conduct) values
      ((select id from public.staff where staff_no='SCD-STF-00001'),'Principal','2025/2026 Third Term',9,9,8,9,10),
      ((select id from public.staff where staff_no='SCD-STF-00002'),'Principal','2025/2026 Third Term',8,7,7,8,8);
  end if;

  -- Certificates
  if (select count(*) from public.certificates) = 0 then
    insert into public.certificates (student_id, type, certificate_no, issued_date, details) values
      ((select id from public.students where admission_no='SCD-00014'),'testimonial','CERT-2026-001',current_date - 10,'Certificate of good conduct and academic excellence.'),
      ((select id from public.students where admission_no='SCD-00015'),'testimonial','CERT-2026-002',current_date - 5,'Academic testimonial for transfer purposes.');
  end if;

  -- Parent Meetings
  if (select count(*) from public.parent_meetings) = 0 then
    insert into public.parent_meetings (title, date, description, status) values
      ('PTA General Meeting — Third Term','2026-07-18','End-of-term PTA meeting to discuss results and next term plans.','completed'),
      ('Open Day — Prospective Parents','2026-08-15','School tour and meet-the-teachers event.','scheduled'),
      ('Career Day','2026-09-20','Annual career guidance day with invited professionals.','scheduled');
  end if;

  -- Career Counseling
  if (select count(*) from public.career_counseling) = 0 then
    insert into public.career_counseling (student_id, session_date, notes, counsellor) values
      ((select id from public.students where admission_no='SCD-00014'),'2026-07-10','Adanna is interested in Medicine. Advised to focus on Biology, Chemistry and Physics.','Mrs. Grace Obi'),
      ((select id from public.students where admission_no='SCD-00015'),'2026-07-12','Emeka is strong in Mathematics and wants Engineering. Advised to take Further Mathematics.','Mrs. Grace Obi');
  end if;

  -- Donations
  if (select count(*) from public.donations) = 0 then
    insert into public.donations (donor_name, amount, purpose, date, acknowledged) values
      ('Chief and Mrs. Adeyemi',500000,'Library renovation','2026-06-15',true),
      ('Old Students Association (Class of 2015)',1000000,'Science lab equipment','2026-05-20',true),
      ('Anonymous',200000,'Scholarship fund','2026-07-01',true);
  end if;

  -- Financial Aid
  if (select count(*) from public.financial_aid) = 0 then
    insert into public.financial_aid (student_id, type, amount, term, session, status) values
      ((select id from public.students where admission_no='SCD-00016'),'scholarship',50000,'Third Term','2025/2026','approved'),
      ((select id from public.students where admission_no='SCD-00017'),'bursary',30000,'Third Term','2025/2026','approved');
  end if;

  -- Gamification
  if (select count(*) from public.gamification_points) = 0 then
    insert into public.gamification_points (student_id, points, reason, date) values
      ((select id from public.students where admission_no='SCD-00014'),50,'Won inter-class quiz',current_date - 5),
      ((select id from public.students where admission_no='SCD-00015'),30,'Perfect attendance this month',current_date - 1),
      ((select id from public.students where admission_no='SCD-00016'),20,'Submitted all assignments on time',current_date - 3);
  end if;

  -- Substitutions
  if (select count(*) from public.substitutions) = 0 then
    insert into public.substitutions (date, period, class, absent_teacher, substitute_teacher, reason) values
      (current_date - 2,'3rd Period','SS 2','Funke Alabi','Chukwuemeka Nwachukwu','Medical appointment'),
      (current_date - 1,'1st Period','JSS 1','Olumide Ajayi','Hauwa Suleiman','Personal leave');
  end if;
end $$;

select 'School Connect DEMO ENHANCED data installed - all pages populated.' as status;

-- 25) Library books and book requests
do $$
begin
  if (select count(*) from public.library_books) = 0 then
    insert into public.library_books (title, author, isbn, category, copies_available, copies_total) values
      ('New Oxford Secondary English Course','Adebayo A. et al','978-019-823-456','English',8,12),
      ('Essential Mathematics for SS','A.J.S. Oluwasanmi','978-978-123-789','Mathematics',5,10),
      ('Modern Biology for SS','S.T. Ramalingam','978-978-456-123','Science',6,10),
      ('Comprehensive Chemistry','O. Adeniji','978-978-789-456','Science',4,8),
      ('Things Fall Apart','Chinua Achebe','978-043-527-891','Literature',10,15),
      ('Purple Hibiscus','Chimamanda N. Adichie','978-000-718-234','Literature',7,10);
  end if;
  if (select count(*) from public.book_requests) = 0 then
    insert into public.book_requests (student_id, book_title, status, request_date) values
      ((select id from public.students where admission_no='SCD-00014'),'Advanced Calculus for SS3','pending',current_date - 3),
      ((select id from public.students where admission_no='SCD-00015'),'Past WAEC Questions — Physics','approved',current_date - 7);
  end if;
end $$;

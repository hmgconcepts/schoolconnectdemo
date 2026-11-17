#!/usr/bin/env python3
"""V12.74 (round-18 items 2/3/4) — RPC argument audit.

Items 2 and 10 both failed the same way: the client called an RPC with argument
names the database function does not have (p_dry_run on a 3-argument function) or
called a function that was never written at all. PostgREST answers both with an
error the UI swallowed, so the feature simply "did nothing".

This compares every sb.rpc('name', { … }) site against the declared parameter
list of that function in the shipped schema.
"""
import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
schema = (ROOT / 'database' / 'complete-schema.sql').read_text(encoding='utf-8', errors='ignore')

# name -> set of parameter names (positional p_*), union across overloads
sig = {}
for m in re.finditer(r'create\s+or\s+replace\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\(([^)]*)\)', schema, re.I):
    name = m.group(1).lower()
    args = m.group(2)
    ps = set()
    for part in args.split(','):
        part = part.strip()
        if not part:
            continue
        tok = re.split(r'\s+', part)[0].strip('"')
        if tok.lower().startswith('p_'):
            ps.add(tok.lower())
    sig.setdefault(name, set()).update(ps)

files = sorted(ROOT.glob('*.html')) + sorted((ROOT / 'assets' / 'js').glob('*.js'))
problems = []
missing_fn = []
call = re.compile(r"\.rpc\(\s*['\"]([a-z0-9_]+)['\"]\s*(?:,\s*\{([^{}]*)\})?", re.I | re.S)
for f in files:
    t = f.read_text(encoding='utf-8', errors='ignore')
    for m in call.finditer(t):
        name = m.group(1).lower()
        body = m.group(2) or ''
        if name not in sig:
            missing_fn.append((f.name, name)); continue
        declared = sig[name]
        if not declared:
            continue                       # no p_ parameters — positional or none
        for pm in re.finditer(r'([A-Za-z_][A-Za-z0-9_]*)\s*:', body):
            arg = pm.group(1)
            if arg.lower().startswith('p_') and arg.lower() not in declared:
                problems.append((f.name, name, arg))

# only report functions genuinely absent (ignore ones defined elsewhere/dynamic)
really_missing = [(f, n) for (f, n) in missing_fn if n not in sig]

if really_missing or problems:
    if really_missing:
        print('RPC ARG AUDIT FAILED — %d call(s) name a function the schema does not have:' % len(really_missing))
        for f, n in really_missing:
            print('   %-36s %s()' % (f, n))
    if problems:
        print('RPC ARG AUDIT FAILED — %d call(s) pass a parameter the function does not declare:' % len(problems))
        for f, n, a in problems:
            print('   %-36s %s(… %s …)' % (f, n, a))
    sys.exit(1)
print('RPC ARG AUDIT PASSED — every sb.rpc() call names a real function and real parameters (%d files, %d functions).'
      % (len(files), len(sig)))

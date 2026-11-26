# Security Summary

**Reviewed Files**: 22
**Issues Resolved**: 11

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Signup Role & Tenant Escalation | `supabase/schema.sql` | 203 | The `handle_new_user()` trigger read `role` and `client_directory_id` directly from client-editable `raw_user_meta_data`, allowing any self-registering user to claim `'admin'` or bind to another tenant directory. | Critical | Fixed | Hardcoded `'client'` and `NULL` inside `handle_new_user()` and removed the constraint requiring `'client'` rows to pre-bind to a directory before Admin assignment. |
| Client Auth Fallback Escalation | `src/lib/authContext.tsx` | 43 | When `user_profiles` had not settled yet, `hydrateFromSupabase` read `meta?.role` and `meta?.client_directory_id` from user metadata to set UI/session roles. | High | Fixed | Locked the fallback profile to `'client'` with `clientDirectoryId: null`, ensuring least privilege until a verified database profile loads. |
| View & Helper RLS Exposure | `supabase/schema.sql` | 46 | The `public.profiles` view omitted `security_invoker = true`, and RLS helper functions were executable by `anon` and `public`. | High | Fixed | Recreated `public.profiles` with `WITH (security_invoker = true)`, revoked public/anon access, and restricted RLS helper execution to `authenticated`. |
| Missing Audit Field Integrity | `supabase/schema.sql` | 270 | Non-admin users could update their own `ledger_entries` rows and tamper with `audit_status`, `audit_note`, or `created_by`. | High | Fixed | Added a `BEFORE INSERT OR UPDATE` trigger `enforce_ledger_audit_integrity()` preventing non-admins from approving entries, altering audit notes, or spoofing `created_by`. |
| Missing Store Ownership & Role Guards | `src/lib/portalStore.ts` | 415 | Store operations trusted caller-supplied `clientId` and `userId` parameters without checking the active signed-in session or directory ownership. | High | Fixed | Added `requireAuthenticatedUser()`, `requireAdminUser()`, and `requireDirectoryAccess(clientId)` across directory, ledger, TIN, audit, and vault operations, plus explicit `userId` ownership check in `changeOwnPassword`. |
| Vulnerable Spreadsheet Dependency | `package.json`, `src/lib/vaultService.ts` | 199 | The `xlsx` (`0.18.5`) dependency carried known high-severity Prototype Pollution and ReDoS advisories when parsing untrusted workbooks. | High | Fixed | Removed `xlsx` from `package.json` and reimplemented `.xlsx` previewing and fallback generation using `fflate` (with entry whitelists and a 64 MB decompression cap) and native `DOMParser`. |
| Spreadsheet Formula Injection | `src/utils/csvCodec.ts`, `src/utils/xlsxExport.ts` | 23, 562 | Exported CSV cells and clipboard HTML/TSV tables wrote untrusted strings (`=`, `+`, `-`, `@`, `\t`, `\r`) directly, allowing Excel/Sheets formula execution on open/paste, and `htmlEsc` did not escape quotes. | Medium | Fixed | Added `neutralizeSpreadsheetFormula` (preserving literal `'-'` placeholders and negative numbers while quoting formula prefixes), escaped `"` and `'` in `htmlEsc`, and stripped tabs/newlines in TSV cells. |
| Unvalidated JSON Backup & CSV Limits | `src/components/ClientDirectoryModal.tsx`, `src/components/ClientWorkspaceView.tsx` | 102, 502 | Backup JSON imports trusted `JSON.parse` without schema validation or prototype-key filtering, and CSV imports lacked file size and row count limits. | Medium | Fixed | Enforced a 10 MB file size cap, 25,000-row CSV limit, `__proto__`/`constructor`/`prototype` key stripping, and strict Zod schema validation (`clientWorkspaceBackupSchema`, `ledgerRowSchema`, `tinRecordSchema`). |
| Missing Auth Rate Limiting & Persistent Preview Session | `src/lib/rateLimit.ts`, `src/lib/authContext.tsx`, `src/pages/LoginPage.tsx` | 57, 134, 93 | Sign-in, password change, and password reset flows had no throttling, and preview session IDs persisted indefinitely in `localStorage`. | Medium | Fixed | Added sliding-window rate limiting with progressive lockout (`AUTH_RATE_LIMIT`, `PASSWORD_CHANGE_RATE_LIMIT`) across preview and Supabase auth flows, and moved preview session storage to `sessionStorage`. |
| Unencrypted Transport & Path Traversal Checks | `src/lib/supabase.ts`, `src/lib/vaultService.ts`, `supabase/schema.sql` | 355 | Supabase URL validation did not enforce HTTPS for non-local endpoints, and storage object keys lacked explicit `..` rejection in client policies. | Medium | Fixed | Enforced `https:` for remote Supabase endpoints, rejected `..` and leading `/` in storage paths and `vaultMetadataInputSchema`, and added `name !~ '\.\.'` to client storage RLS policies. |
| Missing HTTP Security Headers | `vercel.json`, `index.html` | 17 | Deployed static assets lacked Content-Security-Policy, clickjacking protection, HSTS, and MIME-sniffing protections. | Medium | Fixed | Configured strict CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `COOP`, and `CORP` in `vercel.json` and meta safeguards in `index.html`. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Secrets & Environment Variables | `.gitignore`, `.env.example`, `src/lib/supabase.ts` | Private keys such as `GEMINI_API_KEY` are never prefixed with `VITE_`; `.gitignore` excludes `.env*` (except `.env.example`), `*.pem`, and `*.key`. Only public Supabase URL and anon key are exposed to the browser, protected by RLS. |
| Database Queries | `src/lib/portalStore.ts` | All Supabase queries use parameterized PostgREST client methods (`eq`, `in`, `insert`, `upsert`, `delete`) with zero raw SQL string interpolation. |
| DOM Rendering & XSS | `src/components/`, `src/utils/xlsxExport.ts` | React escapes all rendered text bindings with zero `dangerouslySetInnerHTML`, `innerHTML`, or `eval` usage; clipboard HTML table payloads escape `&`, `<`, `>`, `"`, and `'`. |
| Password Hashing (Preview Mode) | `src/lib/crypto.ts` | Local preview accounts use PBKDF2-SHA256 (`120,000` iterations, random 16-byte salt) and constant-time comparison rather than plaintext storage. |

## PoC Verification

### 1. Signup Privilege Escalation via Client Metadata

#### Summary
| Field | Value |
|---|---|
| Issue Type | Broken Access Control / Role Escalation |
| Impact | Critical |
| Affected File | `supabase/schema.sql:203`, `src/lib/authContext.tsx:43` |
| Test Scenario | `supabase.auth.signUp({ email, password, options: { data: { role: 'admin', client_directory_id: '<victim-uuid>' } } })` |

#### How It Was Fixed
Removed all trust in client-supplied `raw_user_meta_data` inside `public.handle_new_user()` and `hydrateFromSupabase()`, forcing every newly created or unsettled profile to `'client'` with no directory assignment (`NULL`).

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | A self-signup request arrives with `raw_user_meta_data: { "role": "admin", "client_directory_id": "<victim-uuid>" }`. | Trigger fires |
| 2 | `public.handle_new_user()` at `supabase/schema.sql:211-220` inserts `'client'` and `NULL` regardless of metadata keys; `hydrateFromSupabase` at `src/lib/authContext.tsx:49-56` likewise sets `role: 'client'` and `clientDirectoryId: null`. | Escalation blocked |
| 3 | The attacker receives zero access to admin tools or any existing `client_directories` rows. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Client-controlled auth metadata can no longer elevate a user to `'admin'` or bind them to another client's directory.

### 2. Cross-Tenant Data Access & Unauthorized Audit Approval

#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Ownership & Role Verification (IDOR) |
| Impact | High |
| Affected File | `src/lib/portalStore.ts:415`, `supabase/schema.sql:270` |
| Test Scenario | Signed-in client user invokes `loadClientLedgerBundle('<other-client-id>')`, `updateLedgerAuditStatus(rowId, 'APPROVED')`, or `UPDATE ledger_entries SET audit_status = 'APPROVED'` via Supabase API. |

#### How It Was Fixed
Added strict session/ownership checks (`requireAdminUser`, `requireDirectoryAccess`) to all store entry points and added a database-level `BEFORE INSERT OR UPDATE` trigger (`enforce_ledger_audit_integrity`) to lock audit columns for non-admins.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Client user (`role: 'client'`, `clientDirectoryId: 'dir-A'`) calls `loadClientLedgerBundle('dir-B')` or `updateLedgerAuditStatus(id, 'APPROVED')`. | Request enters guard |
| 2 | `requireDirectoryAccess('dir-B')` at `src/lib/portalStore.ts:423-431` verifies `sessionUser.clientDirectoryId === 'dir-B'` and throws `'Access denied: you do not have permission for this client directory.'`; `updateLedgerAuditStatus` calls `requireAdminUser()` at `src/lib/portalStore.ts:1221`. | Blocked in app layer |
| 3 | If the user bypasses the UI and hits PostgREST directly, `enforce_ledger_audit_integrity()` at `supabase/schema.sql:270-292` checks `NOT public.is_admin()` and raises an exception if `audit_status` or `audit_note` changes or `audit_status = 'APPROVED'`. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Both the client store layer and PostgreSQL triggers/RLS enforce strict tenant isolation and admin-only audit approvals.

### 3. Spreadsheet Formula Injection & Vulnerable XLSX Parser

#### Summary
| Field | Value |
|---|---|
| Issue Type | Formula Injection / Vulnerable Third-Party Parser |
| Impact | High |
| Affected File | `src/utils/csvCodec.ts:23`, `src/utils/xlsxExport.ts:562`, `src/lib/vaultService.ts:199` |
| Test Scenario | Ledger `payor` or `remarks` containing `=cmd|'/C calc'!A0` exported to CSV/Google Sheets clipboard, or malformed `.xlsx` archive uploaded to Vault preview. |

#### How It Was Fixed
Replaced `xlsx@0.18.5` with `fflate` + native `DOMParser` (with 64 MB entry caps and column/row bounds) and added `neutralizeSpreadsheetFormula()` on all CSV and Google Sheets clipboard cell outputs.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `payor = "=cmd|'/C calc'!A0"` passes into `exportFilingCsv` or `copyFilingTableForGoogleSheets`. | Enters cell encoder |
| 2 | `neutralizeSpreadsheetFormula` at `src/utils/csvCodec.ts:23-38` detects leading `=` (while leaving literal `'-'` and negative numbers untouched) and prepends `'`, producing `'=cmd|'/C calc'!A0`. | Formula neutralized |
| 3 | When previewing `.xlsx` uploads in `previewXlsxFirst20Rows` (`src/lib/vaultService.ts:199`), `fflate.unzipSync` filters entries against an XML whitelist and rejects oversized entries before `DOMParser` parses XML safely without script execution or Prototype Pollution. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Exported spreadsheets neutralize formula payloads cleanly and `.xlsx` previews run without the vulnerable `xlsx` package.

### 4. JSON Backup Prototype Pollution & Schema Bypass

#### Summary
| Field | Value |
|---|---|
| Issue Type | Unsafe Deserialization / Missing Input Validation |
| Impact | Medium |
| Affected File | `src/components/ClientDirectoryModal.tsx:102`, `src/lib/validation.ts:9` |
| Test Scenario | Importing a crafted `.json` backup containing `{"__proto__": {"polluted": true}, "salesRows": [...]}` or invalid numeric/string fields. |

#### How It Was Fixed
Added a 10 MB file size cap, recursive `__proto__`/`constructor`/`prototype` key removal (`stripDangerousKeysDeep`), and full Zod schema validation (`clientWorkspaceBackupSchema`) before passing data into state or storage.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Crafted `.json` file is selected in `handleImportBackupFile` at `src/components/ClientDirectoryModal.tsx:99`. | File size checked (`<= 10 MB`) |
| 2 | `stripDangerousKeysDeep` at `src/lib/validation.ts:9-22` drops `__proto__`, `constructor`, and `prototype` keys; `clientWorkspaceBackupSchema.safeParse(raw)` at `src/components/ClientDirectoryModal.tsx:112` validates every row and field type. | Malformed fields rejected |
| 3 | Only validated, sanitized records reach `onImportClientBackup`. | **Handled Safely** |

#### Conclusion
**Fix Verified** - Oversized, malformed, or prototype-polluting JSON backups are rejected before mutating application state.

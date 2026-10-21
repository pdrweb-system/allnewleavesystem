# ทดสอบหน้าเว็บแบบ end-to-end (ในเครื่อง)

รันหน้าเว็บจริงใน Chromium กับ "Supabase จำลอง" ในเครื่อง:
Postgres 16 + migration ชุดเดียวกับโปรเจกต์ → PostgREST ตัวจริง → เกตเวย์จำลอง Auth/Storage
(`gateway.mjs` ให้ policy ใน `storage.objects` และ RLS เป็นผู้ตัดสินเหมือนบน Supabase) → Edge Function
`admin-users` รันด้วย Deno — Playwright ดักคำขอที่ไปยัง URL ของโปรเจกต์แล้วส่งเข้าเกตเวย์แทน
จึงไม่ต้องแก้ `js/config.js` หรือ CSP

สิ่งที่ต้องมี: Postgres 16 ที่รัน `supabase/tests/local/run_local_tests.sh` ได้, ไบนารี `postgrest` (v12),
`deno`, Chromium และโฟลเดอร์เครื่องมือที่ติดตั้ง `pg` + `playwright-core` แล้ว

```bash
E2E_TOOLS=/path/to/tools DENO=/path/to/deno node tests/e2e/run.mjs
```

ผลลัพธ์ (ภาพหน้าจอ, ใบลา PDF, ไฟล์ Excel, results.json) อยู่ใน `$E2E_TOOLS/out`

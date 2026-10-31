// รัน Edge Function บนพอร์ตที่กำหนด (ในฟังก์ชันเรียก Deno.serve โดยไม่ระบุพอร์ต จึงฟังที่ 8000 เสมอ)
// ใช้: deno run --allow-net --allow-env --allow-read tests/e2e/serve-function.ts <พอร์ต> <ไฟล์ index.ts ของฟังก์ชัน>
const [port, file] = Deno.args;
const serve = Deno.serve;
Object.defineProperty(Deno, 'serve', {
  value: (handler: Deno.ServeHandler) => serve({ port: Number(port), hostname: '127.0.0.1' }, handler),
});
await import(new URL(file, `file://${Deno.cwd()}/`).href);

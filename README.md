# Portal Tugas — Database Server (HP + Laptop)

Data tersimpan di **server** (`data/db.json`), jadi terlihat di semua perangkat.

## Jalankan lokal
```bash
cd portal-tugas
node server.js
```
Buka http://localhost:3000/login.html

## Deploy ke Render (gratis) — agar online di HP & laptop

1. Buat akun di https://render.com
2. New → **Web Service**
3. Upload / connect repo berisi folder portal-tugas
4. Settings:
   - **Build Command:** (kosong) atau `echo ok`
   - **Start Command:** `node server.js`
   - **Instance:** Free
5. Setelah live, buka URL Render, contoh:
   `https://nama-app.onrender.com/login.html`

Admin: `/admin.html` — password `admin123`  
(Ganti password: set env `ADMIN_PASS` di Render)

## Fitur
- 1 tugas = max 20 soal pilihan ganda
- Kunci jawaban (tidak bisa diubah)
- Akun baru otomatis melihat tugas admin

# Tele-USG (Medical Internet of Things-Based Tele-Ultrasonography)

**Tele-USG** merupakan sistem telemedicine berbasis arsitektur *Medical Internet of Things (MIoT)* yang dirancang untuk memungkinkan komunikasi dan panduan diagnostik **real-time** antara operator alat USG (misal: di fasilitas kesehatan primer/puskesmas) dan tenaga medis spesialis (misal: di rumah sakit rujukan) melalui jaringan lokal maupun internet (WiFi/4G Cellular).

Aplikasi terpisah dari platform pihak ketiga seperti Zoom/Meet. Sistem ini dibangun dengan protokol **WebRTC (Web Real-Time Communication)** yang menjamin komunikasi asinkron *peer-to-peer* *(P2P)* bervideo latensi rendah dengan enkripsi bawaan.

## Arsitektur Sistem

Proyek ini dibangun menggunakan arsitektur MIoT tiga layer yang mengintegrasikan konsep **Edge Computing**:

1.  **Perception Layer**: Menggunakan mesin ultrasonografi nyata (Mindray DP-10) dengan *output* VGA. Sinyal video ditangkap menggunakan PC eksternal atau laptop melalui USB Capture Card serta sebuah webcam untuk menampilkan operator USG.
2.  **Network Layer**: Menggunakan server *signaling* (Firebase) untuk pertukaran Session Description Protocol (SDP) dan negosiasi *Interactive Connectivity Establishment* (ICE) *(STUN/TURN)* untuk keperluan menembus batas jaringan (NAT Traversal). Aliran media (Video/Audio) USG menggunakan komunikasi Peer-to-Peer dari WebRTC. Aplikasi klien juga mempergunakan Websocket untuk menjalankan komunikasi *stream* data secara lokal di Edge Gateway.
3.  **Application Layer**: Aplikasi interaktif berbasis Desktop (Electron.js) untuk pihak operator dan spesialis yang mendukung pertukaran video berkecepatan tinggi, kontrol sesi jarak jauh, dan memonitor parameter Quality of Service (QoS) seperti Delay, Throughput, Packet Loss, dan Jitter.

### Edge Computing di Sisi Operator
Sistem mengolah video ultrasonografi pada sumber asalnya *(edge gateway)*. Ekstraksi visual pada input VGA dilakukan oleh *Python OpenCV*, sebelum dilakukan pra-pemrosesan mandiri (kompresi JPEG dan *resizing* menjadi 720p pada 20 FPS). Data tersebut dipaketkan lalu diteruskan ke aplikasi Desktop Electron.js melalui server transport lokal (Websocket) sebelum pada akhirnya dipancarkan ke jaringan via WebRTC. Ini meminimalisir delay dan beban *payload* jaringan.

---

## Riwayat Pengembangan (Changelog)

Aplikasi Tele-USG telah dikembangkan secara bertahap demi mencapai efisiensi komunikasi *telemedicine* yang optimal. Berikut adalah evolusi dari proyek ini:

### v1 (Concept & Prototyping Phase)
- Implementasi awal pengumpulan (*capture*) citra ultrasonografi memanfaatkan skrip terpisah Python (`OpenCV`).
- Prototipe awal penerapan koneksi *Peer-to-Peer* (P2P) WebRTC dengan modul `aiortc` di lingkungan Python.
- Uji coba pensignalan awal memanfaatkan server *cloud* dari Firebase.
- Pengenalan dasar Model AI untuk integrasi riset di waktu mendatang.

### v2 (Web-Based Tele-USG Server)
- Transisi membentuk sebuah sistem utuh berbasis Web Interface terintegrasi.
- Menggunakan **Flask (Python)** sebagai Web Server (men-serving HTML, JS) untuk komunikasi *real-time*.
- Konektivitas *socket* awal diletakkan pada fondasi ini sebagai aplikasi yang siap dijalankan secara lokal/terdistribusi antar jaringan.

### v3 (Transisi Pertama ke Desktop App)
- Pengadopsian teknologi aplikasi desktop modern menggunakan **ElectronJS** dan **Express** (Node.js) sebagai backend UI lokal.
- Pemrosesan Capture USG VGA tetap ditangani oleh Python yang berjalan sebagai proses asinkron pendukung (`python_usg`).
- Mulai dirancangnya antarmuka grafis yang ramah pengguna untuk pengguna Desktop (*Operator / Spesialis*).

### v4 & v5 (Desktop App Enhancement & Refinements)
- **v4**: Perombakan dan pembagian ulang pada susunan proses `renderer` ElectronJS. Implementasi struktur file sistem pengguna, *styling* tingkat lanjut, beserta peningkatan UI/UX guna menyokong kenyamanan diagnostik.
- **v5**: Penambahan fungsionalitas UI secara drastis serta pra-persiapan modifikasi file untuk memasukki masa pembangunan kompilasi produksi (*production release build*). Stabilisasi transmisi antara proses NodeJS dan Python Websocket lokal.

### v6 (Final Release - Full Desktop & Advanced Features)
- **Produksi Aplikasi Mandiri**: Pembangunan instalator `.exe` untuk *environment* Windows menggunakan `electron-builder`.
- **Portabilitas Optimal**: Ditambahkannya integrasi `python_portable`, agar PC pengguna akhir dapat langsung menjalankan penangkap USG Python *embedded* tanpa membutuhkan instalasi Python manual dari awal.
- **Advanced Network Features**: Integrasi otomatis *Tunneling* menggunakan `ngrok` untuk membuat jembatan aman HTTP tanpa *port forwarding* lokal manual, dipadukan pada komunikasi Firebase RTC. Tersedia juga integrasi Cloud Storage (`cloudinary` dan Firebase Storage) untuk skenario penyimpanan data/riwayat gambar pasien.
- **Caliper Measurement Tool**: Implementasi fitur klinis *Canvas Drawing*, yang mengizinkan pihak dokter spesialis untuk mengambil gambar *freeze* USG dan melakukan pengukuran spasial interaktif secara kalibrasi visual persis layaknya alat USG asli, dikirim kembali lewat *IPC handler* menuju ruang obrolan operator.

---
*Proyek ini merupakan bagian dari riset Tele-USG di School of Electrical Engineering, Telkom University.*
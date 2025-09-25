import tkinter as tk
from tkinter import messagebox
from tkinterweb.htmlwidgets import HtmlFrame
import pyrebase
import webbrowser
import uuid
import json

# Konfigurasi Firebase
firebase_config = {
    "apiKey": "AIzaSyDaytDfGyusxu-3waYR5U9vBFmfTEQTv4Q",
    "authDomain": "teleusgchat.firebaseapp.com",
    "databaseURL": "https://teleusgchat-default-rtdb.asia-southeast1.firebasedatabase.app/",
    "projectId": "teleusgchat",
    "storageBucket": "teleusgchat.firebasestorage.app",
    "messagingSenderId": "623391086693",
    "appId": "1:623391086693:web:fbd62c11da5b6f80f6ce8c",
    "measurementId": "G-Z0B4NGPKX7"
}

# Inisialisasi Firebase
firebase = pyrebase.initialize_app(firebase_config)
db = firebase.database()  # Untuk integrasi dengan chat jika perlu

# GUI Tkinter
root = tk.Tk()
root.title("Tele-USG Video Call")
root.geometry("400x300")

# Variabel untuk room ID
room_id = None

# Fungsi untuk membuat room
def create_room():
    global room_id
    room_id = str(uuid.uuid4())  # Generate kode unik
    link = f"teleusg://call?room={room_id}"  # Link sederhana (bisa dibagikan via chat)
    room_label.config(text=f"Room ID: {room_id}\nLink: {link}")
    create_btn.config(state='disabled')
    join_entry.config(state='disabled')
    join_btn.config(state='disabled')
    open_video_page()

# Fungsi untuk join room
def join_room():
    global room_id
    room_id = join_entry.get().strip()
    if not room_id:
        messagebox.showerror("Error", "Masukkan Room ID!")
        return
    room_label.config(text=f"Joined Room: {room_id}")
    create_btn.config(state='disabled')
    join_entry.config(state='disabled')
    join_btn.config(state='disabled')
    open_video_page()

# Fungsi untuk buka halaman WebRTC
def open_video_page():
    # Simpan room_id ke file sementara untuk diakses oleh HTML
    with open("room_config.json", "w") as f:
        json.dump({"room_id": room_id}, f)
    # Buka halaman WebRTC di browser default
    webbrowser.open("file://C:/Riza/Kuliah/TeleUSG-proto/meet_test_firebase/video_page.html")  # Ganti dengan path ke video_page.html

# UI Elements
tk.Label(root, text="Tele-USG Video Call", font=("Arial", 14)).pack(pady=10)

create_btn = tk.Button(root, text="Buat Room", command=create_room)
create_btn.pack(pady=5)

tk.Label(root, text="Masukkan Room ID:").pack()
join_entry = tk.Entry(root)
join_entry.pack(pady=5)

join_btn = tk.Button(root, text="Join Room", command=join_room)
join_btn.pack(pady=5)

room_label = tk.Label(root, text="Room ID: Belum dibuat", wraplength=350)
room_label.pack(pady=10)

# Binding Enter untuk join
join_entry.bind("<Return>", lambda e: join_room())

root.mainloop()
browser = HtmlFrame(root)
browser.load_file("video_page.html")
browser.pack(fill="both", expand=True)
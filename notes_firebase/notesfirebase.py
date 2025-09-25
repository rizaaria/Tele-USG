import tkinter as tk
from tkinter import scrolledtext, ttk, messagebox
import pyrebase
from datetime import datetime

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

firebase = pyrebase.initialize_app(firebase_config)
db = firebase.database()

mode = input("Mode: dokter (isi template) atau viewer (lihat saja)? ").lower()
case_id = input("Masukkan Case ID (e.g., usg_001): ") or "usg_default"

root = tk.Tk()
root.title(f"Tele-USG Catatan Dokter - Case {case_id}")
root.geometry("600x700")

notes_area = scrolledtext.ScrolledText(root, wrap=tk.WORD, width=70, height=25, state='disabled')
notes_area.pack(padx=10, pady=10)

def display_notes(notes_data):
    notes_area.config(state='normal')
    notes_area.delete(1.0, tk.END) 
    if notes_data:
        display_text = f"Catatan Dokter Spesialis - Case {case_id}\n"
        display_text += f"Tanggal: {notes_data.get('timestamp', 'N/A')}\n\n"
        display_text += f"Data Pasien:\n- Nama: {notes_data.get('patient_name', 'N/A')}\n- Usia Ibu: {notes_data.get('mother_age', 'N/A')} tahun\n- Umur Kehamilan: {notes_data.get('gestational_age', 'N/A')} minggu\n\n"
        display_text += f"Biometri Janin:\n- BPD: {notes_data.get('bpd', 'N/A')} mm\n- HC: {notes_data.get('hc', 'N/A')} cm\n- AC: {notes_data.get('ac', 'N/A')} cm\n- FL: {notes_data.get('fl', 'N/A')} mm\n- EFW: {notes_data.get('efw', 'N/A')} g\n\n"
        display_text += f"Penilaian Anatomi: {notes_data.get('anatomy_assessment', 'N/A')}\n"
        display_text += f"Diagnosis: {notes_data.get('diagnosis', 'N/A')}\n"
        display_text += f"Rekomendasi: {notes_data.get('recommendations', 'N/A')}\n\n"
        display_text += f"Catatan Tambahan:\n{notes_data.get('additional_notes', 'N/A')}\n"
        notes_area.insert(tk.END, display_text)
    notes_area.config(state='disabled')
    notes_area.yview(tk.END)

def stream_handler(message):
    data = message.get("data")
    if data:
        display_notes(data)

db.child(f"notes/{case_id}").stream(stream_handler)

if mode == 'dokter':
    form_frame = tk.Frame(root)
    form_frame.pack(padx=10, pady=5, fill=tk.X)
    
    tk.Label(form_frame, text="Nama Pasien:").grid(row=0, column=0, sticky=tk.W)
    patient_entry = tk.Entry(form_frame)
    patient_entry.grid(row=0, column=1)
    
    tk.Label(form_frame, text="Usia Ibu:").grid(row=1, column=0, sticky=tk.W)
    age_entry = tk.Entry(form_frame)
    age_entry.grid(row=1, column=1)
    
    tk.Label(form_frame, text="BPD (mm):").grid(row=2, column=0, sticky=tk.W)
    bpd_entry = tk.Entry(form_frame)
    bpd_entry.grid(row=2, column=1)
    
    # ... Tambah field lain seperti HC, AC, dll. (lihat tabel)
    
    tk.Label(form_frame, text="Diagnosis:").grid(row=10, column=0, sticky=tk.W)
    diagnosis_entry = tk.Text(form_frame, height=3, width=50)
    diagnosis_entry.grid(row=10, column=1, columnspan=2)
    
    tk.Label(form_frame, text="Catatan Tambahan:").grid(row=11, column=0, sticky=tk.W)
    additional_entry = tk.Text(form_frame, height=4, width=50)
    additional_entry.grid(row=11, column=1, columnspan=2)
    
    def submit_notes():
        notes = {
            'patient_name': patient_entry.get(),
            'mother_age': age_entry.get(),
            'bpd': bpd_entry.get(),
            # ... Ambil nilai field lain
            'diagnosis': diagnosis_entry.get("1.0", tk.END).strip(),
            'additional_notes': additional_entry.get("1.0", tk.END).strip(),
            'timestamp': datetime.now().isoformat(),
            'doctor_id': 'Dr. Spesialis'  # Bisa dari login nanti
        }
        try:
            db.child(f"notes/{case_id}").set(notes)
            messagebox.showinfo("Sukses", "Catatan tersimpan dan dibagikan!")
        except Exception as e:
            messagebox.showerror("Error", str(e))
    
    submit_btn = tk.Button(form_frame, text="Submit Catatan", command=submit_notes)
    submit_btn.grid(row=12, column=1, pady=10)

# Binding Enter untuk submit jika dokter mode
if mode == 'dokter':
    root.bind("<Return>", lambda e: submit_notes())

root.mainloop()
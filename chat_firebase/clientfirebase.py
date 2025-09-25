import tkinter as tk
from tkinter import scrolledtext
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

def send_message():
    message = message_entry.get()
    if message.strip():
        try:
            db.child("chats").child("teleusg_room").push({
                "nickname": nickname,
                "message": message,
                "timestamp": datetime.now().isoformat()
            })
            message_entry.delete(0, tk.END)
            print(f"Sent message: {nickname}: {message}")  # Debug
        except Exception as e:
            print(f"Error sending message: {e}")

def display_message(message):
    chat_area.config(state='normal')
    chat_area.insert(tk.END, message + "\n")
    chat_area.config(state='disabled')
    chat_area.yview(tk.END)

def stream_handler(message):
    print("Stream event:", message)  
    path = message.get("path", "")
    data = message.get("data")

    if data is not None:
        if path != "/":  # Hanya proses update pesan baru
            if isinstance(data, dict) and "nickname" in data and "message" in data:
                msg_text = f"{data['nickname']}: {data['message']}"
                root.after(0, display_message, msg_text)

nickname = input("Choose a nickname: ")

# GUI
root = tk.Tk()
root.title(f"Tele-USG Chat - {nickname}")
root.geometry("400x500")

chat_area = scrolledtext.ScrolledText(root, wrap=tk.WORD, width=40, height=20, state='disabled')
chat_area.pack(padx=10, pady=10)

input_frame = tk.Frame(root)
input_frame.pack(padx=10, pady=5, fill=tk.X)

message_entry = tk.Entry(input_frame)
message_entry.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(0, 5))

send_button = tk.Button(input_frame, text="Send", command=send_message)
send_button.pack(side=tk.RIGHT)

try:
    db.child("chats").child("teleusg_room").stream(stream_handler)
    print("Stream started successfully")
except Exception as e:
    print(f"Streaming error: {e}")

message_entry.bind("<Return>", lambda event: send_message())

root.mainloop()
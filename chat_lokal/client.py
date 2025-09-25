import threading
import socket
import tkinter as tk
from tkinter import scrolledtext

nickname = input("Choose a nickname: ")  
client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
client.connect(("192.168.0.167", 55555))

# Inisialisasi GUI
root = tk.Tk()
root.title(f"Chat Client - {nickname}")
root.geometry("400x500")

chat_area = scrolledtext.ScrolledText(root, wrap=tk.WORD, width=40, height=20, state='disabled')
chat_area.pack(padx=10, pady=10)

input_frame = tk.Frame(root)
input_frame.pack(padx=10, pady=5, fill=tk.X)

message_entry = tk.Entry(input_frame)
message_entry.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(0, 5))

def send_message():
    message = message_entry.get()
    if message.strip():
        full_message = f"{nickname}: {message}"
        client.send(full_message.encode("ascii"))
        message_entry.delete(0, tk.END)

send_button = tk.Button(input_frame, text="Send", command=send_message)
send_button.pack(side=tk.RIGHT)

def display_message(message):
    chat_area.config(state='normal')
    chat_area.insert(tk.END, message + "\n")
    chat_area.config(state='disabled')
    chat_area.yview(tk.END)

def receive():
    while True:
        try:
            message = client.recv(1024).decode("ascii")
            if message == 'NAME':
                client.send(nickname.encode("ascii"))
            else:
                root.after(0, display_message, message)
        except:
            root.after(0, display_message, "An error occurred!")
            client.close()
            break

receive_thread = threading.Thread(target=receive)
receive_thread.daemon = True 
receive_thread.start()

message_entry.bind("<Return>", lambda event: send_message())

root.mainloop()
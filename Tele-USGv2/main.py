from flask import Flask, render_template
import pyrebase

app = Flask(__name__, static_folder="static", template_folder="templates")

# ===============================
# 🔹 Firebase Config
# ===============================
firebase_config = {
    "apiKey": "AIzaSyDaytDfGyusxu-3waYR5U9vBFmfTEQTv4Q",
    "authDomain": "teleusgchat.firebaseapp.com",
    "databaseURL": "https://teleusgchat-default-rtdb.asia-southeast1.firebasedatabase.app/",
    "projectId": "teleusgchat",
    "storageBucket": "teleusgchat.appspot.com",
    "messagingSenderId": "623391086693",
    "appId": "1:623391086693:web:fbd62c11da5b6f80f6ce8c",
    "measurementId": "G-Z0B4NGPKX7"
}

firebase = pyrebase.initialize_app(firebase_config)
db = firebase.database()

# ===============================
# 🔹 ROUTES
# ===============================
@app.route('/')
def index():
    return render_template('login.html')

@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")

@app.route("/login")
def login_page():
    return render_template("login.html")

@app.route("/register")
def register_page():
    return render_template("register.html")

@app.route("/join")
def join_page():
    return render_template("join.html")

@app.route('/create')
def create_meeting():
    return render_template('create.html')

# ===============================
# 🔹 Meeting Room (Dynamic Route)
# ===============================
@app.route("/meeting/<room_id>")
def meeting_room(room_id):
    # Cek apakah room ID ada di Firebase
    room_data = db.child("meetings").child(room_id).get().val()

    if room_data is None:
        # Room tidak ditemukan
        return render_template("error.html",
                               message=f"Room '{room_id}' tidak ditemukan."), 404
    else:
        # Room ditemukan → buka halaman meeting
        return render_template("meeting.html", room_id=room_id)

@app.route("/config")
def config():
    return {
        "signaling_url": "ws://127.0.0.1:8080/ws"
    }

# ===============================
# Jalankan Flask
# ===============================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)


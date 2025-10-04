# desktop_app/app.py
import sys
from PyQt5.QtWidgets import QApplication
from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEngineProfile, QWebEnginePage
from PyQt5.QtCore import QUrl

URL = "https://nonatomically-pseudomodern-nakesha.ngrok-free.dev"  # ganti dengan URL ngrok kamu

class CustomWebEnginePage(QWebEnginePage):
    def __init__(self, profile, parent=None):
        super().__init__(profile, parent)
        # sambungkan sinyal permission request ke handler
        self.featurePermissionRequested.connect(self.onFeaturePermissionRequested)

    def onFeaturePermissionRequested(self, securityOrigin, feature):
        print(f"Permintaan izin: {feature} dari {securityOrigin.host()}")
        if feature in (
            QWebEnginePage.MediaAudioCapture,
            QWebEnginePage.MediaVideoCapture,
            QWebEnginePage.MediaAudioVideoCapture,
        ):
            print("✅ Kamera & mikrofon diizinkan otomatis.")
            self.setFeaturePermission(
                securityOrigin,
                feature,
                QWebEnginePage.PermissionGrantedByUser,
            )
        else:
            self.setFeaturePermission(
                securityOrigin,
                feature,
                QWebEnginePage.PermissionDeniedByUser,
            )

def main():
    app = QApplication(sys.argv)
    profile = QWebEngineProfile.defaultProfile()
    page = CustomWebEnginePage(profile)

    view = QWebEngineView()
    view.setPage(page)
    view.setWindowTitle("Tele-USG P2P (Desktop)")
    view.resize(1000, 700)
    view.load(QUrl(URL))
    view.show()

    sys.exit(app.exec_())

if __name__ == "__main__":
    main()

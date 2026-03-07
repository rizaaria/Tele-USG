import sys, os
from PyQt5.QtWidgets import QApplication
from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEngineProfile, QWebEnginePage
from PyQt5.QtCore import QUrl, QEventLoop

URL = "http://127.0.0.1:5000"

class CustomWebEnginePage(QWebEnginePage):
    def __init__(self, profile, parent=None):
        super().__init__(profile, parent)
        self.featurePermissionRequested.connect(self.autoGrantPermission)

    def autoGrantPermission(self, origin, feature):
        print(f"Izinkan fitur: {feature} untuk {origin.host()}")
        self.setFeaturePermission(origin, feature, QWebEnginePage.PermissionGrantedByUser)


class CustomWebEngineView(QWebEngineView):
    def contextMenuEvent(self, event):
        event.ignore() 
        print("Klik kanan dinonaktifkan di Tele-USG Desktop.")


def main():
    # Konfigurasi WebEngine agar tidak blokir kamera/mic & autoplay
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (
        "--use-fake-ui-for-media-stream "
        "--enable-media-stream "
        "--enable-webrtc "
        "--autoplay-policy=no-user-gesture-required "
        "--disable-logging "
        "--no-sandbox "
        "--disable-web-security "
    )

    app = QApplication(sys.argv)
    profile = QWebEngineProfile.defaultProfile()

    # Nonaktifkan cache agar perubahan web langsung ter-update
    profile.setCachePath("")
    profile.setPersistentCookiesPolicy(QWebEngineProfile.NoPersistentCookies)

    page = CustomWebEnginePage(profile)
    view = CustomWebEngineView()
    view.setPage(page)
    view.setWindowTitle("Tele-USG Desktop")
    view.resize(1200, 800)
    view.load(QUrl(URL))
    view.show()

    # Tunggu sampai halaman selesai load sebelum event loop dimulai
    loop = QEventLoop()
    view.loadFinished.connect(loop.quit)
    loop.exec_()

    sys.exit(app.exec_())


if __name__ == "__main__":
    main()

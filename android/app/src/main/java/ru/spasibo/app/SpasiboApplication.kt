package ru.spasibo.app

import android.app.Application
import com.google.firebase.FirebaseApp
import ru.spasibo.app.widget.WidgetRefreshWorker

class SpasiboApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (FirebaseApp.getApps(this).isEmpty()) {
            FirebaseApp.initializeApp(this)
        }
        WidgetRefreshWorker.ensurePeriodic(this)
    }
}
